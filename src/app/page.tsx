'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { generateTOTP } from '@/lib/totp';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { toast } from 'sonner';
import DailyMenuOrdering from '@/components/DailyMenuOrdering';
import ActiveOrders from '@/components/ActiveOrders';

interface Student {
  studentId: number;
  name: string;
  paidStatus: number;
}

interface Redemption {
  mealSlot: string;
}

export default function Home() {
  const [currentDate, setCurrentDate] = useState(() => new Date().toLocaleDateString('sv'));
  const [isSecureEnv, setIsSecureEnv] = useState(true);

  // --- Student Auth States ---
  const [authStep, setAuthStep] = useState<'id' | 'password' | 'setup_password' | 'choose_section' | 'logged_in'>('id');
  const [selectedSection, setSelectedSection] = useState<'hostlers_menu' | 'daily_ordering' | null>(null);
  const [studentIdInput, setStudentIdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [studentName, setStudentName] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // --- Student Dashboard States ---
  const [activeStudent, setActiveStudent] = useState<Student | null>(null);
  const [studentRedemptions, setStudentRedemptions] = useState<Redemption[]>([]);
  const [studentMealCodes, setStudentMealCodes] = useState<{ slot: string; name: string; raw: string; hash: string }[]>([]);
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
  const [selectedQrCode, setSelectedQrCode] = useState<{ name: string; hash: string; url: string; slot: string } | null>(null);
  const [isRegisteringBiometric, setIsRegisteringBiometric] = useState(false);
  const [biometricMessage, setBiometricMessage] = useState('');
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [showInfoCard, setShowInfoCard] = useState(false);
  const [dailyMenu, setDailyMenu] = useState<{ [key: string]: string }>({});

  // New State for Dynamic QR
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpToken, setTotpToken] = useState<string>('');
  const [timeLeft, setTimeLeft] = useState<number>(30);
  const [qrUrl, setQrUrl] = useState<string>('');
  const [timeOffset, setTimeOffset] = useState<number>(0);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    setTimeout(() => {
      setIsSecureEnv(window.isSecureContext && !!navigator.credentials);
      const savedId = localStorage.getItem('studentId');
      if (savedId) setStudentIdInput(savedId);
    }, 0);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowInfoCard(true);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Generate small QR codes (static or dynamic)
  useEffect(() => {
    async function generateQRs() {
      const urls: Record<string, string> = {};
      const QRCode = (await import('qrcode')).default;
      for (const item of studentMealCodes) {
        if (!item.hash) continue;
        try {
          let payload;
          if (totpSecret && totpToken) {
            payload = JSON.stringify({
              s: parseInt(studentIdInput, 10),
              m: item.slot,
              t: totpToken
            });
          } else {
            payload = `${studentIdInput}:${item.hash}`;
          }
          const url = await QRCode.toDataURL(payload, {
            margin: 1, width: 220,
            color: { dark: '#09090b', light: '#ffffff' }
          });
          urls[item.slot] = url;
        } catch (err) { }
      }
      setQrUrls(urls);
    }
    if (studentMealCodes.length > 0) generateQRs();
    else setTimeout(() => setQrUrls(prev => Object.keys(prev).length > 0 ? {} : prev), 0);
  }, [studentMealCodes, studentIdInput, totpSecret, totpToken]);

  // Ref to prevent duplicate in-flight fetchDashboardData calls (Opt 5)
  const isFetchingDashboard = useRef(false);

  const fetchDashboardData = useCallback(async (silent = false) => {
    if (isFetchingDashboard.current) return; // deduplicate concurrent calls
    isFetchingDashboard.current = true;
    try {
      const res = await fetch(`/api/students?id=${studentIdInput}&date=${currentDate}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setActiveStudent(data.student);
      setStudentRedemptions(data.redemptions);
      setHasBiometrics(!!data.hasBiometrics);
      setStudentMealCodes(data.mealCodes || []);
      if (data.totpSecret) {
        setTotpSecret(data.totpSecret);
      }
      if (data.serverTime) {
        setTimeOffset(data.serverTime - Date.now());
      }
      if (data.dailyMenu) {
        setDailyMenu({
          '01': data.dailyMenu.breakfast || '',
          '02': data.dailyMenu.lunch || '',
          '03': data.dailyMenu.dinner || ''
        });
      } else {
        setDailyMenu({});
      }
      setAuthStep('choose_section');
    } catch (err) {
      if (!silent) {
        toast.error('Could not load dashboard data.');
      }
    } finally {
      isFetchingDashboard.current = false;
    }
  }, [studentIdInput, currentDate]);

  // Lightweight polling — only fetches mealSlot status, not the full dashboard (Opt 2)
  const fetchRedemptions = useCallback(async () => {
    try {
      const res = await fetch(`/api/students/redemptions?id=${studentIdInput}&date=${currentDate}`);
      if (!res.ok) return;
      const data = await res.json();
      setStudentRedemptions(data.redemptions || []);
    } catch (err) {
      // Fail silently — polling errors shouldn't toast the user
    }
  }, [studentIdInput, currentDate]);

  const isSlotRedeemed = (slot: string, redemptionList: Redemption[]) => {
    return redemptionList.some((r) => r.mealSlot === slot);
  };

  // Poll lightweight redemptions endpoint when QR code is expanded (Opt 2)
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (selectedQrCode) {
      const isRedeemed = isSlotRedeemed(selectedQrCode.slot, studentRedemptions);
      if (!isRedeemed) {
        interval = setInterval(() => {
          fetchRedemptions();
        }, 500);
      }
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [selectedQrCode, studentRedemptions, studentIdInput, currentDate, fetchRedemptions]);

  // Global timer for TOTP token & countdown
  useEffect(() => {
    if (!totpSecret) return;
    
    const updateTimer = () => {
      const compensatedTime = Date.now() + timeOffset;
      const newToken = generateTOTP(totpSecret, 30, compensatedTime);
      setTotpToken(newToken);
      
      const epoch = Math.floor(compensatedTime / 1000);
      const remaining = 30 - (epoch % 30);
      setTimeLeft(remaining);
    };
    
    updateTimer();
    const intervalId = setInterval(updateTimer, 1000);
    return () => clearInterval(intervalId);
  }, [totpSecret, timeOffset]);

  // Generate large QR code for modal
  useEffect(() => {
    if (!selectedQrCode) return;
    
    // capture for typescript closure
    const currentSelected = selectedQrCode;
    
    async function generateLargeQR() {
      let payload;
      if (totpSecret && totpToken) {
        payload = JSON.stringify({
          s: parseInt(studentIdInput, 10),
          m: currentSelected.slot,
          t: totpToken
        });
      } else {
        payload = `${studentIdInput}:${currentSelected.hash}`;
      }
      try {
        const QRCode = (await import('qrcode')).default;
        const url = await QRCode.toDataURL(payload, {
          width: 400,
          margin: 2,
          color: { dark: '#18181b', light: '#ffffff' }
        });
        setQrUrl(url);
      } catch (err) {
        setQrUrl(currentSelected.url);
      }
    }
    
    generateLargeQR();
  }, [selectedQrCode, studentIdInput, totpSecret, totpToken]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedQrCode) {
        setSelectedQrCode(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedQrCode]);

  // Manage Screen Wake Lock when QR code is expanded
  useEffect(() => {
    if (selectedQrCode && 'wakeLock' in navigator) {
      const requestWakeLock = async () => {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        } catch (err) {
          console.error("Wake Lock request failed:", err);
        }
      };
      requestWakeLock();
    }
    
    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(console.error);
        wakeLockRef.current = null;
      }
    };
  }, [selectedQrCode]);

  // --- Student Auth Methods ---
  const handleCheckId = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentIdInput || studentIdInput.length !== 5) {
      toast.error('Please enter a valid 5-digit Student ID.');
      return;
    }
    setIsAuthenticating(true);
    try {
      const res = await fetch(`/api/auth/check?id=${studentIdInput}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStudentName(data.name);
      setPasswordInput('');
      setShowPassword(false);
      localStorage.setItem('studentId', studentIdInput);
      if (data.hasPasswordSet) {
        setAuthStep('password');
      } else {
        setAuthStep('setup_password');
      }
    } catch (err: any) {
      toast.error(err.message || 'Verification failed. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSetupPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticating(true);
    try {
      const res = await fetch(`/api/auth/setup-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: studentIdInput, password: passwordInput })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Setup failed.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticating(true);
    try {
      const res = await fetch(`/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: studentIdInput, password: passwordInput })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Login failed.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleBiometricLogin = async () => {
    setIsAuthenticating(true);
    try {
      const optRes = await fetch(`/api/auth/webauthn/generate-authentication`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: studentIdInput })
      });
      const options = await optRes.json();
      if (!optRes.ok) throw new Error(options.error);

      let authResp;
      try {
        authResp = await startAuthentication({ optionsJSON: options });
      } catch (err) {
        throw new Error('Biometric authentication cancelled or failed.');
      }

      const verifyRes = await fetch(`/api/auth/webauthn/verify-authentication`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: studentIdInput, response: authResp })
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.verified) throw new Error(verifyData.error || 'Verification failed');

      await fetchDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Biometric login failed.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleRegisterBiometric = async () => {
    setIsRegisteringBiometric(true);
    setBiometricMessage('');
    try {
      const optRes = await fetch(`/api/auth/webauthn/generate-registration`);
      const options = await optRes.json();
      if (!optRes.ok) throw new Error(options.error);

      let attResp;
      try {
        attResp = await startRegistration({ optionsJSON: options });
      } catch (err) {
        throw new Error('Registration cancelled or failed.');
      }

      const verifyRes = await fetch(`/api/auth/webauthn/verify-registration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attResp)
      });
      const verifyData = await verifyRes.json();

      if (!verifyRes.ok || !verifyData.verified) throw new Error(verifyData.error || 'Verification failed');

      setHasBiometrics(true);
      setBiometricMessage('Device registered successfully.');
      setTimeout(() => setBiometricMessage(''), 5000);
    } catch (err: any) {
      setBiometricMessage(`Error: ${err.message}`);
      setTimeout(() => setBiometricMessage(''), 5000);
    } finally {
      setIsRegisteringBiometric(false);
    }
  };

  const handleStudentLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuthStep('id');
    setPasswordInput('');
    setActiveStudent(null);
    setStudentRedemptions([]);
    setStudentMealCodes([]);
    setSelectedQrCode(null);
    setHasBiometrics(false);
    setSelectedSection(null);
  };

  const handleSectionSelect = (section: 'hostlers_menu' | 'daily_ordering') => {
    setSelectedSection(section);
    if (section === 'hostlers_menu') {
      setAuthStep('logged_in');
    }
    // daily_ordering stays on choose_section with its own UI
  };

  // --- Components ---
  const isDashboardMode = authStep === 'logged_in' || (authStep === 'choose_section' && selectedSection !== null);

  return (
    <main className="min-h-screen pb-24 text-zinc-100 relative overflow-x-hidden font-sans flex flex-col">

      {/* Starry Name Plate Header (for both sections) */}
      {isDashboardMode && activeStudent && (
        <header className="w-full px-4 max-w-md md:max-w-4xl mx-auto pt-4 sm:pt-8 shrink-0">
          <div className="bg-black p-4 sm:p-6 rounded-2xl flex justify-between items-center border border-zinc-800/80 relative overflow-hidden animate-fade-in w-full shadow-xl gap-2">
            {/* Star backdrop wrapper with delayed fade-in */}
            <div className="absolute inset-0 w-full h-full pointer-events-none animate-stars-fade select-none">
              {/* Rich Star field */}
              <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
                {/* Tiny background stars */}
                <circle cx="5%" cy="30%" r="0.8" className="fill-white/30" />
                <circle cx="12%" cy="70%" r="1" className="fill-white/40 animate-[pulse_3s_infinite_0.5s]" />
                <circle cx="22%" cy="15%" r="0.8" className="fill-white/30" />
                <circle cx="28%" cy="85%" r="1.2" className="fill-white/60 animate-[pulse_2.5s_infinite]" />
                <circle cx="38%" cy="25%" r="1" className="fill-white/40 animate-[pulse_3s_infinite_1.2s]" />
                <circle cx="45%" cy="60%" r="0.8" className="fill-white/30" />
                <circle cx="50%" cy="15%" r="1.2" className="fill-white/80 animate-[pulse_2s_infinite]" />
                <circle cx="58%" cy="75%" r="1" className="fill-white/50 animate-[pulse_4s_infinite_0.5s]" />
                <circle cx="64%" cy="35%" r="1.5" className="fill-white/60 animate-[pulse_2.5s_infinite_1s]" />
                <circle cx="70%" cy="85%" r="0.8" className="fill-white/40" />
                <circle cx="76%" cy="20%" r="1.2" className="fill-white/90 animate-[pulse_3.5s_infinite_1.2s]" />
                <circle cx="82%" cy="60%" r="1" className="fill-white/60 animate-[pulse_2s_infinite_0.8s]" />
                <circle cx="88%" cy="80%" r="1.5" className="fill-white/70 animate-[pulse_3s_infinite_1.5s]" />
                <circle cx="92%" cy="25%" r="0.8" className="fill-white/40" />
                <circle cx="96%" cy="65%" r="1.2" className="fill-white/80 animate-[pulse_4s_infinite_2s]" />
                <circle cx="98%" cy="15%" r="1.5" className="fill-white/90 animate-[pulse_2.5s_infinite_0.3s]" />

                {/* Shining 4-point star flares */}
                <svg x="40%" y="30%" className="overflow-visible animate-[pulse_2.5s_infinite_0.8s]">
                  <path d="M0 -3 L0.7 -0.7 L3 0 L0.7 0.7 L0 3 L-0.7 0.7 L-3 0 L-0.7 -0.7 Z" fill="#ffffff" />
                </svg>
                <svg x="62%" y="20%" className="overflow-visible animate-[pulse_2s_infinite_0.5s]">
                  <path d="M0 -3.5 L0.8 -0.8 L3.5 0 L0.8 0.8 L0 3.5 L-0.8 0.8 L-3.5 0 L-0.8 -0.8 Z" fill="#ffffff" />
                </svg>
                <svg x="78%" y="70%" className="overflow-visible animate-[pulse_3s_infinite_1.5s]">
                  <path d="M0 -4 L1 -1 L4 0 L1 1 L0 4 L-1 1 L-4 0 L-1 -1 Z" fill="#ffffff" />
                </svg>
                <svg x="90%" y="35%" className="overflow-visible animate-[pulse_2.5s_infinite_1s]">
                  <path d="M0 -3.5 L0.8 -0.8 L3.5 0 L0.8 0.8 L0 3.5 L-0.8 0.8 L-3.5 0 L-0.8 -0.8 Z" fill="#ffffff" />
                </svg>
              </svg>

              {/* Gradient overlay to smoothly hide stars behind the name/ID text */}
              <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-transparent w-[50%] z-0"></div>

              {/* Shooting Stars */}
              <div className="absolute top-0 right-[15%] w-[120px] h-[1px] bg-gradient-to-r from-white to-transparent origin-left animate-shoot-1 z-0"></div>
              <div className="absolute top-1 right-[35%] w-[90px] h-[1px] bg-gradient-to-r from-white/70 to-transparent origin-left animate-shoot-2 z-0"></div>
            </div>

            <div className="space-y-1 text-left relative z-10 shrink-0">
              <h3 className="text-base sm:text-lg font-bold text-zinc-100 leading-tight">{activeStudent.name}</h3>
              <p className="text-xs sm:text-sm text-zinc-400">ID: <span className="text-zinc-200 font-medium">{activeStudent.studentId}</span></p>
            </div>
            <div className="flex gap-2 relative z-10 shrink-0">
              <button onClick={() => { setAuthStep('choose_section'); setSelectedSection(null); }} className="px-3 sm:px-4 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-300 hover:text-white text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4 sm:hidden">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
                <span className="hidden sm:inline">Menu</span>
              </button>
              <button onClick={handleStudentLogout} className="px-3 sm:px-4 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-300 hover:text-white text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4 sm:hidden">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                </svg>
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </header>
      )}

      {/* --- STUDENT PORTAL CONTENT --- */}
      <div className="flex-1 flex flex-col w-full py-8 md:py-12">
        <section className={`w-full px-4 my-auto ${isDashboardMode ? 'max-w-md md:max-w-4xl mx-auto' : authStep === 'choose_section' ? 'max-w-2xl mx-auto' : 'max-w-md animate-float mx-auto'}`}>

        {authStep === 'id' && (
          <>
            <div className="glass-card max-w-md mx-auto w-full p-8 rounded-2xl space-y-6 text-left shadow-xl">
              <div className="text-center pb-3 border-b border-zinc-800">
                <h3 className="text-2xl font-bold text-zinc-100">Meal Portal</h3>
                <p className="text-sm text-zinc-400 mt-2">Enter Student ID.</p>
              </div>
              <form onSubmit={handleCheckId} className="space-y-4">
                <input type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={5} placeholder="Student ID" value={studentIdInput} onChange={(e) => setStudentIdInput(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-4 px-4 text-base focus:border-zinc-500 font-medium text-center text-zinc-100" required />
                <button type="submit" disabled={isAuthenticating} className="w-full btn-zinc font-bold text-sm py-4 rounded-xl">{isAuthenticating ? 'Checking...' : 'Continue'}</button>
              </form>
            </div>

            {/* Demo Helper */}
            {process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true' && (
              <div className="glass-card max-w-md mx-auto w-full mt-4 p-6 rounded-2xl space-y-4 text-center shadow-xl border border-zinc-800">
                <div className="space-y-2">
                  <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Demo Accounts</p>
                  <div className="flex flex-col gap-2 justify-center">
                    <div className="flex gap-2 w-full">
                      <button type="button" onClick={() => setStudentIdInput('10001')} className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 px-4 py-2 rounded-lg transition-colors cursor-pointer font-medium w-full">Paid (10001)</button>
                      <button type="button" onClick={() => setStudentIdInput('10002')} className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 px-4 py-2 rounded-lg transition-colors cursor-pointer font-medium w-full">Unpaid (10002)</button>
                    </div>
                    <button type="button" onClick={() => setStudentIdInput('10003')} className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 px-4 py-2 rounded-lg transition-colors cursor-pointer font-medium w-full">Unregistered (10003)</button>
                  </div>
                </div>
                <div className="pt-2 border-t border-zinc-800/50">
                  <a href="/warden/login" className="text-xs text-zinc-400 hover:text-zinc-200 font-medium transition-colors inline-flex items-center gap-1">
                    Try Warden Dashboard Demo
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                  </a>
                </div>
              </div>
            )}
          </>
        )}

        {authStep === 'setup_password' && (
          <>
            <div className="glass-card max-w-md mx-auto w-full p-8 rounded-2xl space-y-6 text-left shadow-xl">
              <div className="border-b border-zinc-800 pb-4">
                <h3 className="text-xl font-bold text-zinc-100">Create Password</h3>
                <p className="text-sm text-zinc-400 mt-2">Setup Password.</p>
                <ul className="text-xs text-zinc-400 mt-4 space-y-1.5 font-medium bg-zinc-900 p-4 rounded-xl border border-zinc-800">
                  <li>• At least 8 characters</li>
                  <li>• Include letters & numbers</li>
                  <li>• Include 1 special character (!@#$)</li>
                </ul>
              </div>
              <form onSubmit={handleSetupPassword} className="space-y-4">
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} placeholder="New Password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-4 pl-4 pr-12 text-base focus:border-zinc-500 text-zinc-100 font-medium" required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-[1.1rem] text-zinc-400 hover:text-zinc-200 cursor-pointer">
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" /><path fillRule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 010-1.113zM17.25 12a5.25 5.25 0 11-10.5 0 5.25 5.25 0 0110.5 0z" clipRule="evenodd" /></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M3.53 2.47a.75.75 0 00-1.06 1.06l18 18a.75.75 0 101.06-1.06l-18-18zM22.676 12.553a11.249 11.249 0 01-2.631 4.31l-3.099-3.099a5.25 5.25 0 00-6.71-6.71L7.759 4.577a11.217 11.217 0 014.242-.827c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113z" /><path d="M15.75 12c0 .18-.013.357-.037.53l-4.244-4.243A3.75 3.75 0 0115.75 12zM12.53 15.713l-4.243-4.244a3.75 3.75 0 004.243 4.243z" /><path d="M6.75 12c0-.619.107-1.213.304-1.764l-3.1-3.1a11.25 11.25 0 00-2.63 4.31c-.12.362-.12.752 0 1.114 1.489 4.467 5.704 7.69 10.675 7.69 1.5 0 2.933-.294 4.242-.827l-2.477-2.477A5.25 5.25 0 016.75 12z" /></svg>
                    )}
                  </button>
                </div>
                <button type="submit" disabled={isAuthenticating} className="w-full btn-zinc font-bold text-sm py-4 rounded-xl">{isAuthenticating ? 'Saving...' : 'Save & Sign In'}</button>
              </form>
            </div>

            {/* Demo Helper */}
            {process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true' && (
              <div className="glass-card max-w-md mx-auto w-full mt-4 p-6 rounded-2xl space-y-2 text-center shadow-xl border border-zinc-800">
                <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Demo Password</p>
                <button type="button" onClick={() => setPasswordInput('password123')} className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 px-4 py-2 rounded-lg transition-colors cursor-pointer w-full font-medium">Quick Fill (password123)</button>
              </div>
            )}
          </>
        )}

        {authStep === 'password' && (
          <>
            <div className="glass-card max-w-md mx-auto w-full p-8 rounded-2xl space-y-6 text-left shadow-xl">
              <div className="flex items-center gap-4 mb-4 bg-zinc-900 p-4 rounded-xl border border-zinc-800">
                <div className="w-12 h-12 rounded-full bg-zinc-200 flex items-center justify-center font-bold text-zinc-900 text-xl">{studentName.charAt(0)}</div>
                <div>
                  <h3 className="text-base font-bold text-zinc-100">{studentName}</h3>
                  <p className="text-xs text-zinc-400">ID: {studentIdInput}</p>
                </div>
              </div>
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} placeholder="Password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-4 pl-4 pr-12 text-base focus:border-zinc-500 text-zinc-100 font-medium" required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-[1.1rem] text-zinc-400 hover:text-zinc-200 cursor-pointer">
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" /><path fillRule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 010-1.113zM17.25 12a5.25 5.25 0 11-10.5 0 5.25 5.25 0 0110.5 0z" clipRule="evenodd" /></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M3.53 2.47a.75.75 0 00-1.06 1.06l18 18a.75.75 0 101.06-1.06l-18-18zM22.676 12.553a11.249 11.249 0 01-2.631 4.31l-3.099-3.099a5.25 5.25 0 00-6.71-6.71L7.759 4.577a11.217 11.217 0 014.242-.827c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113z" /><path d="M15.75 12c0 .18-.013.357-.037.53l-4.244-4.243A3.75 3.75 0 0115.75 12zM12.53 15.713l-4.243-4.244a3.75 3.75 0 004.243 4.243z" /><path d="M6.75 12c0-.619.107-1.213.304-1.764l-3.1-3.1a11.25 11.25 0 00-2.63 4.31c-.12.362-.12.752 0 1.114 1.489 4.467 5.704 7.69 10.675 7.69 1.5 0 2.933-.294 4.242-.827l-2.477-2.477A5.25 5.25 0 016.75 12z" /></svg>
                    )}
                  </button>
                </div>
                <button type="submit" disabled={isAuthenticating} className="w-full btn-zinc font-bold text-sm py-4 rounded-xl">{isAuthenticating ? 'Logging in...' : 'Sign In'}</button>
              </form>

              <div className="relative py-4">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-800"></div></div>
                <div className="relative flex justify-center"><span className="bg-zinc-900 px-4 text-xs text-zinc-500 font-bold uppercase tracking-wider">OR</span></div>
              </div>

              <button onClick={handleBiometricLogin} disabled={isAuthenticating || !isSecureEnv} className={`w-full ${!isSecureEnv ? 'bg-zinc-950 text-zinc-600 cursor-not-allowed border-zinc-900' : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 cursor-pointer border-zinc-700'} border text-sm font-bold py-4 rounded-xl flex justify-center items-center gap-2 transition-colors`}>
                {isSecureEnv ? 'Use Passkey / Biometrics' : 'HTTPS Required for Biometrics'}
              </button>

              <button onClick={() => setAuthStep('id')} className="w-full text-xs text-zinc-500 hover:text-zinc-300 font-medium mt-4 cursor-pointer text-center">Sign in as different user.</button>
            </div>

            {/* Demo Helper */}
            {process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true' && (
              <div className="glass-card max-w-md mx-auto w-full mt-4 p-6 rounded-2xl space-y-2 text-center shadow-xl border border-zinc-800">
                <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Demo Password</p>
                <button type="button" onClick={() => setPasswordInput('password123')} className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 px-4 py-2 rounded-lg transition-colors cursor-pointer w-full font-medium">Quick Fill (password123)</button>
              </div>
            )}
          </>
        )}

        {authStep === 'choose_section' && activeStudent && !selectedSection && (
          <div className="space-y-8 animate-fade-in w-full">
            {/* Header */}
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-zinc-100 tracking-tight">Welcome back, {activeStudent.name.split(' ')[0]}.</h2>
              <p className="text-sm text-zinc-400">Choose where you&apos;d like to go.</p>
            </div>

            {/* Section Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Daily Menu Ordering Card */}
              <button
                onClick={() => handleSectionSelect('daily_ordering')}
                className="glass-card group relative p-8 rounded-2xl text-left cursor-pointer transition-colors focus:outline-none overflow-hidden"
              >
                <div className="space-y-4">
                  <div className="w-14 h-14 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-7 h-7 text-zinc-300">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                    </svg>
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="text-xl font-bold text-zinc-100">Daily Menu Ordering</h3>
                    <p className="text-sm text-zinc-400 leading-relaxed">Browse the daily menu and place your meal orders for the day.</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-400 group-hover:text-zinc-200 transition-colors pt-1">
                    <span>Open</span>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-3.5 h-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </div>
                </div>
              </button>

              {/* Hostlers Menu Card */}
              <button
                onClick={() => handleSectionSelect('hostlers_menu')}
                className="glass-card group relative p-8 rounded-2xl text-left cursor-pointer transition-colors focus:outline-none overflow-hidden"
              >
                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="w-14 h-14 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-7 h-7 text-zinc-300">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75H16.5v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75H16.5v-.75z" />
                      </svg>
                    </div>
                    {activeStudent.paidStatus !== 1 && (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-5 h-5 text-red-400 mt-4 mr-1">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="text-xl font-bold text-zinc-100">Hostlers Menu</h3>
                    <p className="text-sm text-zinc-400 leading-relaxed">View your daily QR passes and check-in status.</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-400 group-hover:text-zinc-200 transition-colors pt-1">
                    <span>Open</span>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-3.5 h-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </div>
                </div>
              </button>
            </div>

            {/* Biometrics Settings */}
            <div className="pt-4">
              <div className="glass-card p-6 rounded-2xl flex flex-col items-center text-center border border-zinc-800 bg-zinc-900/50 space-y-4 max-w-sm mx-auto">
                <div className="space-y-1">
                  <h4 className="text-base font-bold text-zinc-100 flex items-center justify-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                    Passkey Sign-In
                  </h4>
                  <p className="text-sm text-zinc-400">
                    {!isSecureEnv ? 'Passkeys require a secure HTTPS connection. They are disabled on local HTTP networks.' : (hasBiometrics ? 'You have registered this device for instant sign-in.' : 'Register this device to sign in instantly next time.')}
                  </p>
                </div>
                <button onClick={handleRegisterBiometric} disabled={isRegisteringBiometric || !isSecureEnv} className={`w-full max-w-sm px-4 py-3 rounded-xl text-sm font-bold transition-all ${!isSecureEnv ? 'bg-zinc-900 text-zinc-600 border border-zinc-800 cursor-not-allowed' : 'bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-white cursor-pointer'}`}>
                  {isRegisteringBiometric ? 'Registering...' : (hasBiometrics ? 'Re-register Device' : 'Register Device')}
                </button>
                {biometricMessage && <p className="text-sm text-zinc-100 font-medium bg-zinc-800 border border-zinc-600 px-4 py-2 rounded-lg w-full max-w-sm mt-2">{biometricMessage}</p>}
              </div>
            </div>

            {/* Sign out link */}
            <div className="text-center pt-2">
              <button onClick={handleStudentLogout} className="px-6 py-2.5 bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 rounded-xl text-zinc-300 hover:text-white text-sm font-bold transition-colors cursor-pointer inline-flex items-center justify-center">
                Sign Out
              </button>
            </div>
          </div>
        )}



        {authStep === 'choose_section' && selectedSection === 'daily_ordering' && activeStudent && (
          <div className="space-y-6 animate-fade-in w-full">
            <DailyMenuOrdering
              studentId={activeStudent.studentId}
              onBack={() => setSelectedSection(null)}
            />
          </div>
        )}

        {authStep === 'logged_in' && activeStudent && (
          <div className="space-y-6 animate-fade-in">

            {activeStudent.paidStatus !== 1 ? (
              <div className="bg-red-950/40 border border-red-900 p-8 rounded-2xl text-center space-y-4 shadow-xl max-w-lg mx-auto">
                <h4 className="text-base font-bold text-red-100">Access Suspended</h4>
                <p className="text-sm text-red-200/70">Mess fee pending. Contact the administration.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-left border-b border-zinc-800 pb-3 flex justify-between items-end">
                  <h3 className="text-lg font-bold text-zinc-100">Daily Passes</h3>
                  <span className="text-sm text-zinc-400 font-medium">{currentDate}</span>
                </div>

                <div className="grid gap-3 sm:gap-4 grid-cols-1 md:grid-cols-3">
                  {studentMealCodes.map((item) => {
                    const redeemed = isSlotRedeemed(item.slot, studentRedemptions);
                    const qrUrl = qrUrls[item.slot] || '';

                    return (
                      <div
                        key={item.slot}
                        className={`glass-card p-4 sm:p-6 pt-6 sm:pt-8 rounded-2xl flex flex-col items-center md:items-start gap-4 relative shadow-lg border ${redeemed
                          ? 'opacity-60 border-zinc-800 bg-zinc-950'
                          : 'border-zinc-700'
                          }`}
                      >
                        <div className="w-full text-left space-y-1.5">
                          <div className="flex justify-between items-center w-full">
                            <h4 className="text-xl font-bold text-zinc-100 leading-none">
                              {item.name}
                            </h4>
                            <span className={`text-xs px-2.5 py-0.5 rounded-md font-bold uppercase tracking-wider ${redeemed
                              ? 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                              : 'bg-emerald-950/40 text-emerald-400 border border-emerald-900'
                              }`}>
                              {redeemed ? 'Checked In' : 'Active'}
                            </span>
                          </div>
                          {!redeemed && (
                            <span className="text-xs text-zinc-500 font-medium block">
                              Tap to View Pass
                            </span>
                          )}
                        </div>

                        <div className="w-full flex justify-center md:mt-2">
                          {qrUrl && (
                            <button
                              disabled={redeemed}
                              onClick={() => setSelectedQrCode({ name: item.name, hash: item.hash, url: qrUrl, slot: item.slot })}
                              className={`p-2 bg-zinc-100 rounded-xl shadow-md ${!redeemed && 'cursor-pointer hover:scale-105 transition-transform'
                                }`}
                            >
                              <img src={qrUrl} alt="QR Pass" className="w-32 h-32 md:w-full md:h-auto md:max-w-[160px] pointer-events-none" />
                            </button>
                          )}
                        </div>
                        {dailyMenu[item.slot] && (
                          <div className="mt-3 text-sm text-zinc-400 text-center w-full capitalize">
                            {dailyMenu[item.slot]}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* QR Modal */}
        {selectedQrCode && (() => {
          const isRedeemed = isSlotRedeemed(selectedQrCode.slot, studentRedemptions);
          return (
            <div
              className="fixed inset-0 z-50 bg-zinc-950/90 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => setSelectedQrCode(null)}
            >
              <div
                className="glass-card max-w-sm w-full p-8 rounded-3xl text-center space-y-6 relative border border-zinc-800 shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {isRedeemed ? (
                  <div className="py-8 space-y-4 animate-fade-in">
                    <div className="w-20 h-20 bg-zinc-900 border border-zinc-700 text-zinc-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-10 h-10">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </div>
                    <h4 className="text-2xl font-bold text-zinc-100">Checked In.</h4>
                    <p className="text-sm text-zinc-400">Pass verified.</p>
                    <button onClick={() => setSelectedQrCode(null)} className="w-full mt-6 bg-zinc-100 hover:bg-white text-zinc-950 text-sm font-bold py-4 rounded-xl transition-colors cursor-pointer">Back to Dashboard</button>
                  </div>
                ) : (
                  <div className="animate-fade-in space-y-6">
                    <div className="text-center">
                      <h4 className="text-xl font-bold text-zinc-100">{selectedQrCode.name} Pass</h4>
                      {dailyMenu[selectedQrCode.slot] && (
                        <p className="text-sm text-zinc-400 mt-1 capitalize">
                          {dailyMenu[selectedQrCode.slot]}
                        </p>
                      )}
                    </div>
                    <div className="flex justify-center bg-zinc-100 p-4 rounded-2xl shadow-inner mx-auto max-w-[240px]">
                      {qrUrl && <img src={qrUrl} alt="Large QR Pass" className="w-full h-auto aspect-square" />}
                    </div>

                    {/* Timer or Static Indicator */}
                    <div className="flex justify-center -mt-2">
                      {totpSecret ? (
                        <span className="text-xs font-medium text-zinc-500 tabular-nums">
                          Refreshing in {String(timeLeft).padStart(2, '0')}s
                        </span>
                      ) : (
                        <span className="text-xs px-2.5 py-0.5 rounded-md font-bold uppercase tracking-wider bg-zinc-900 text-zinc-500 border border-zinc-800">
                          Static Pass
                        </span>
                      )}
                    </div>

                    <button onClick={() => setSelectedQrCode(null)} className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm font-bold py-4 rounded-xl transition-colors cursor-pointer">Close Window</button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </section>
      </div>

      {/* Project Info Card Centered Overlay */}
      {process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === 'true' && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/70 backdrop-blur-sm transition-all duration-300 ${showInfoCard ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}>
          <div className={`max-w-md w-full bg-zinc-900/90 border border-zinc-800 p-8 rounded-2xl shadow-2xl text-left transform transition-all duration-300 ${showInfoCard ? 'translate-y-0 scale-100 animate-float' : 'translate-y-4 scale-95'
            }`}>
            {/* Header */}
            <div className="flex justify-between items-start mb-5 border-b border-zinc-800 pb-3">
              <h4 className="text-sm font-bold text-zinc-100">
                This is a live demo
              </h4>
            </div>

            {/* Content */}
            <div className="space-y-4">
              {/* Overview / Introduction */}
              <div className="space-y-1">
                <h5 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Overview</h5>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  This platform features two integrated systems: a <span className="text-zinc-100 font-semibold">Student Portal</span> for viewing mess menus and retrieving QR food passes, and a <span className="text-zinc-100 font-semibold">Warden Portal</span> for scanning and verifying active student QR passes to record food distribution.
                </p>
              </div>

              {/* Demo Instructions */}
              <div className="space-y-2.5 pt-3 border-t border-zinc-800/60">
                <h5 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Demo Instructions</h5>
                <ul className="space-y-2.5 text-xs text-zinc-100 leading-relaxed font-medium">
                  <li className="flex items-start gap-2">
                    <span className="text-zinc-100 text-sm leading-none">•</span>
                    <span>The login pages have &apos;Quick Fill&apos; buttons for accessing predetermined Demo Accounts.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-zinc-100 text-sm leading-none">•</span>
                    <span>You can sign in as a paid student, an unpaid student, or an unregistered student.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-zinc-100 text-sm leading-none">•</span>
                    <span>We set up 10003 for you to see the password setup flow.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-zinc-100 text-sm leading-none">•</span>
                    <span>Head to the Warden Portal and access it using the warden_demo autofill.</span>
                  </li>
                </ul>
              </div>

              {/* Action Close Button */}
              <div className="pt-4 border-t border-zinc-800/60">
                <button
                  onClick={() => {
                    setShowInfoCard(false);
                  }}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-bold py-3.5 rounded-xl transition-colors cursor-pointer text-center"
                >
                  Understood.
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="absolute bottom-6 w-full text-center">
        <p className="text-lg font-normal font-pixel text-zinc-600">CampusBytes.</p>
      </footer>
    </main>
  );
}
