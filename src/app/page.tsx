'use client';

import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import hmacSHA256 from 'crypto-js/hmac-sha256';
import Hex from 'crypto-js/enc-hex';

interface Student {
  studentId: number;
  name: string;
  paidStatus: number;
}

interface Redemption {
  id: number;
  studentId: number;
  date: string;
  mealSlot: string;
  redeemedAt: string;
}

const SECRET_KEY = 'Janet123';

// Fallback HMAC generation using crypto-js so it works on HTTP LAN (mobile dev testing)
function generateClientHMAC(message: string, secret: string): string {
  try {
    const hash = hmacSHA256(message, secret);
    return hash.toString(Hex);
  } catch (err) {
    console.error("HMAC generation failed:", err);
    return '';
  }
}

export default function Home() {
  const [currentDate, setCurrentDate] = useState('');
  const [isSecureEnv, setIsSecureEnv] = useState(true);

  // --- Student Auth States ---
  const [authStep, setAuthStep] = useState<'id' | 'password' | 'setup_password' | 'logged_in'>('id');
  const [studentIdInput, setStudentIdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [studentName, setStudentName] = useState('');
  const [authError, setAuthError] = useState('');
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

  // Set date on client & check secure context
  useEffect(() => {
    setCurrentDate(new Date().toISOString().split('T')[0]);
    setIsSecureEnv(window.isSecureContext && !!navigator.credentials);
  }, []);

  // Compute codes
  useEffect(() => {
    function computeCodes() {
      if (!activeStudent || activeStudent.paidStatus !== 1 || !currentDate) {
        setStudentMealCodes([]);
        return;
      }
      const slots = [
        { slot: '01', name: 'Breakfast' },
        { slot: '02', name: 'Lunch' },
        { slot: '03', name: 'Dinner' }
      ];
      const computed = slots.map((item) => {
        const raw = `${activeStudent.studentId}-${currentDate}-${item.slot}`;
        const hash = generateClientHMAC(raw, SECRET_KEY);
        return { slot: item.slot, name: item.name, raw, hash };
      });
      setStudentMealCodes(computed);
    }
    computeCodes();
  }, [activeStudent, currentDate]);

  // Generate QR codes
  useEffect(() => {
    async function generateQRs() {
      const urls: Record<string, string> = {};
      for (const item of studentMealCodes) {
        if (!item.hash) continue;
        try {
          const url = await QRCode.toDataURL(item.hash, {
            margin: 1, width: 220,
            color: { dark: '#09090b', light: '#ffffff' }
          });
          urls[item.slot] = url;
        } catch (err) { }
      }
      setQrUrls(urls);
    }
    if (studentMealCodes.length > 0) generateQRs();
    else setQrUrls({});
  }, [studentMealCodes]);

  // Poll dashboard data when QR code is selected to catch live redemptions
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (selectedQrCode) {
      const isRedeemed = isSlotRedeemed(selectedQrCode.slot, studentRedemptions);
      if (!isRedeemed) {
        interval = setInterval(() => {
          fetchDashboardData();
        }, 1500); // 1.5s fast polling
      }
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [selectedQrCode, studentRedemptions, studentIdInput, currentDate]);

  // --- Student Auth Methods ---
  const handleCheckId = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentIdInput || studentIdInput.length !== 5) {
      setAuthError('Please enter a valid 5-digit Student ID.');
      return;
    }
    setIsAuthenticating(true);
    setAuthError('');
    try {
      const res = await fetch(`/api/auth/check?id=${studentIdInput}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStudentName(data.name);
      setPasswordInput('');
      setShowPassword(false);
      if (data.hasPasswordSet) {
        setAuthStep('password');
      } else {
        setAuthStep('setup_password');
      }
    } catch (err: any) {
      setAuthError(err.message || 'Verification failed. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSetupPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticating(true);
    setAuthError('');
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
      setAuthError(err.message || 'Setup failed.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticating(true);
    setAuthError('');
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
      setAuthError(err.message || 'Login failed.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleBiometricLogin = async () => {
    setIsAuthenticating(true);
    setAuthError('');
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
      setAuthError(err.message || 'Biometric login failed.');
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

  const fetchDashboardData = async () => {
    try {
      const res = await fetch(`/api/students?id=${studentIdInput}&date=${currentDate}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setActiveStudent(data.student);
      setStudentRedemptions(data.redemptions);
      setHasBiometrics(!!data.hasBiometrics);
      setAuthStep('logged_in');
    } catch (err) {
      setAuthError('Could not load dashboard data.');
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
  };

  const isSlotRedeemed = (slot: string, redemptionList: Redemption[]) => {
    return redemptionList.some((r) => r.mealSlot === slot);
  };

  // --- Components ---
  const SecuritySetupBlock = () => {
    return (
      <div className="glass-card p-6 rounded-2xl flex flex-col items-center text-center border border-zinc-800 bg-zinc-900/50 space-y-4">
        <div className="space-y-1">
          <h4 className="text-base font-bold text-zinc-100 flex items-center justify-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
            Passwordless Login
          </h4>
          <p className="text-sm text-zinc-400">
            {!isSecureEnv ? 'Passkeys require a secure HTTPS connection. They are disabled on local HTTP networks.' : (hasBiometrics ? 'You have registered this device for instant login.' : 'Register this device to sign in instantly next time.')}
          </p>
        </div>
        <button onClick={handleRegisterBiometric} disabled={isRegisteringBiometric || !isSecureEnv} className={`w-full max-w-sm px-4 py-3 rounded-xl text-sm font-bold transition-all ${!isSecureEnv ? 'bg-zinc-900 text-zinc-600 border border-zinc-800 cursor-not-allowed' : 'bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-white cursor-pointer'}`}>
          {isRegisteringBiometric ? 'Registering...' : (hasBiometrics ? 'Re-register Device' : 'Register Device')}
        </button>
        {biometricMessage && <p className="text-sm text-zinc-100 font-medium bg-zinc-800 border border-zinc-600 px-4 py-2 rounded-lg w-full max-w-sm mt-2">{biometricMessage}</p>}
      </div>
    );
  };

  return (
    <main className={`min-h-screen bg-zinc-950 pb-24 text-zinc-100 relative overflow-hidden font-sans ${authStep !== 'logged_in' ? 'flex flex-col justify-center items-center' : ''}`}>


      {/* --- STUDENT PORTAL --- */}
      <section className={`w-full px-4 ${authStep !== 'logged_in' ? 'max-w-md' : 'max-w-md md:max-w-4xl mx-auto mt-8'}`}>

        {authStep === 'id' && (
          <div className="glass-card max-w-md mx-auto w-full p-8 rounded-2xl space-y-6 text-left shadow-xl">
            <div className="text-center pb-3 border-b border-zinc-800">
              <h3 className="text-2xl font-bold text-zinc-100">Meal Portal.</h3>
              <p className="text-sm text-zinc-400 mt-2">Enter Student ID.</p>
            </div>
            <form onSubmit={handleCheckId} className="space-y-4">
              <input type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={5} placeholder="Student ID" value={studentIdInput} onChange={(e) => setStudentIdInput(e.target.value.replace(/\D/g, ''))} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-4 px-4 text-base focus:border-zinc-500 font-medium text-center text-zinc-100" required />
              {authError && <p className="text-xs text-zinc-100 font-medium bg-red-950/40 border border-red-900 px-4 py-3 rounded-lg text-center">{authError}</p>}
              <button type="submit" disabled={isAuthenticating} className="w-full btn-zinc font-bold text-sm py-4 rounded-xl">{isAuthenticating ? 'Checking...' : 'Continue'}</button>
            </form>
          </div>
        )}

        {authStep === 'setup_password' && (
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
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-5 top-4 text-zinc-400 hover:text-zinc-200 text-xs font-bold">{showPassword ? 'Hide' : 'Show'}</button>
              </div>
              {authError && <p className="text-xs text-zinc-100 font-medium bg-red-950/40 border border-red-900 px-4 py-3 rounded-lg text-center">{authError}</p>}
              <button type="submit" disabled={isAuthenticating} className="w-full btn-zinc font-bold text-sm py-4 rounded-xl">{isAuthenticating ? 'Saving...' : 'Save & Sign In'}</button>
            </form>
          </div>
        )}

        {authStep === 'password' && (
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
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-5 top-4 text-zinc-400 hover:text-zinc-200 text-xs font-bold">{showPassword ? 'Hide' : 'Show'}</button>
              </div>
              {authError && <p className="text-xs text-zinc-100 font-medium bg-red-950/40 border border-red-900 px-4 py-3 rounded-lg text-center">{authError}</p>}
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
        )}

        {authStep === 'logged_in' && activeStudent && (
          <div className="space-y-6 animate-fade-in">
            <div className="bg-black p-6 rounded-2xl flex justify-between items-center border border-zinc-800/80 relative overflow-hidden">
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

              <div className="space-y-1 text-left relative z-10">
                <h3 className="text-lg font-bold text-zinc-100 leading-tight">{activeStudent.name}</h3>
                <p className="text-sm text-zinc-400">ID: <span className="text-zinc-200 font-medium">{activeStudent.studentId}</span></p>
              </div>
              <button onClick={handleStudentLogout} className="px-4 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-300 hover:text-white text-xs font-bold transition-colors relative z-10 cursor-pointer">Sign Out</button>
            </div>

            {!hasBiometrics && <SecuritySetupBlock />}

            {activeStudent.paidStatus !== 1 ? (
              <div className="bg-zinc-900 border border-zinc-700 p-8 rounded-2xl text-center space-y-4 shadow-xl max-w-lg mx-auto">
                <h4 className="text-base font-bold text-zinc-100">Access Suspended</h4>
                <p className="text-sm text-zinc-400">Mess fee pending. Clear dues to access passes.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-left border-b border-zinc-800 pb-3 flex justify-between items-end">
                  <h3 className="text-lg font-bold text-zinc-100">Daily Passes</h3>
                  <span className="text-sm text-zinc-400 font-medium">{currentDate}</span>
                </div>

                {/* DESKTOP RESPONSIVE GRID */}
                <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
                  {studentMealCodes.map((item) => {
                    const redeemed = isSlotRedeemed(item.slot, studentRedemptions);
                    const qrUrl = qrUrls[item.slot] || '';

                    return (
                      <div
                        key={item.slot}
                        className={`glass-card p-6 rounded-2xl flex flex-row md:flex-col items-center md:items-start justify-between md:justify-center gap-4 relative shadow-lg border ${redeemed
                          ? 'opacity-60 border-zinc-800 bg-zinc-950'
                          : 'border-zinc-700'
                          }`}
                      >
                        <div className="space-y-3 flex-1 text-left">
                          <h4 className="text-xl font-bold text-zinc-100 leading-none">
                            {item.name}
                          </h4>
                          <div className="flex items-center gap-3">
                            <span className={`inline-block text-xs px-3 py-1 rounded-md font-bold uppercase tracking-wider ${redeemed
                              ? 'bg-zinc-900 text-zinc-500'
                              : 'bg-emerald-950/40 text-emerald-400 border border-emerald-900'
                              }`}>
                              {redeemed ? 'Redeemed' : 'Active'}
                            </span>
                            {!redeemed && (
                              <span className="text-xs text-zinc-500 font-medium md:hidden">
                                Tap QR →
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex-shrink-0 md:w-full md:flex md:justify-center md:mt-2">
                          {qrUrl && (
                            <button
                              disabled={redeemed}
                              onClick={() => setSelectedQrCode({ name: item.name, hash: item.hash, url: qrUrl, slot: item.slot })}
                              className={`p-2 bg-zinc-100 rounded-xl shadow-md ${!redeemed && 'cursor-pointer hover:scale-105 transition-transform'
                                }`}
                            >
                              <img src={qrUrl} className="w-20 h-20 md:w-full md:h-auto md:max-w-[160px] pointer-events-none" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {hasBiometrics && <div className="pt-8"><SecuritySetupBlock /></div>}
          </div>
        )}

        {/* QR Modal */}
        {selectedQrCode && (() => {
          const isRedeemed = isSlotRedeemed(selectedQrCode.slot, studentRedemptions);
          return (
            <div className="fixed inset-0 z-50 bg-zinc-950/90 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="glass-card max-w-sm w-full p-8 rounded-3xl text-center space-y-6 relative border border-zinc-800 shadow-2xl overflow-hidden">
                {isRedeemed ? (
                  <div className="py-8 space-y-4 animate-fade-in">
                    <div className="w-20 h-20 bg-zinc-900 border border-zinc-700 text-zinc-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-10 h-10">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </div>
                    <h4 className="text-2xl font-bold text-zinc-100">Pass Redeemed.</h4>
                    <p className="text-sm text-zinc-400">Pass verified.</p>
                    <button onClick={() => setSelectedQrCode(null)} className="w-full mt-6 bg-zinc-100 hover:bg-white text-zinc-950 text-sm font-bold py-4 rounded-xl transition-colors cursor-pointer">Back to Dashboard</button>
                  </div>
                ) : (
                  <div className="animate-fade-in space-y-6">
                    <div>
                      <h4 className="text-xl font-bold text-zinc-100">{selectedQrCode.name} Pass</h4>
                      <p className="text-sm text-zinc-400 mt-1">Show to scanner.</p>
                    </div>
                    <div className="flex justify-center bg-zinc-100 p-4 rounded-2xl shadow-inner mx-auto max-w-[240px]">
                      <img src={selectedQrCode.url} className="w-full h-auto pointer-events-none" />
                    </div>
                    <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                      <p className="text-xs text-zinc-500 font-bold mb-2">Hash Code</p>
                      <p className="text-xs font-mono text-zinc-400 break-all">{selectedQrCode.hash}</p>
                    </div>
                    <button onClick={() => setSelectedQrCode(null)} className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm font-bold py-4 rounded-xl transition-colors cursor-pointer">Close Window</button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </section>

      <footer className="absolute bottom-6 w-full text-center">
        <p className="text-lg font-normal font-pixel text-white">CampusByte.</p>
      </footer>
    </main>
  );
}
