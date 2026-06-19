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
  const [viewMode, setViewMode] = useState<'student' | 'warden'>('student');
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
  const [selectedQrCode, setSelectedQrCode] = useState<{ name: string; hash: string; url: string } | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isRegisteringBiometric, setIsRegisteringBiometric] = useState(false);
  const [biometricMessage, setBiometricMessage] = useState('');
  const [hasBiometrics, setHasBiometrics] = useState(false);

  // --- Warden States ---
  const [wardenPin, setWardenPin] = useState('');
  const [isWardenAuthenticated, setIsWardenAuthenticated] = useState(false);
  const [wardenPinError, setWardenPinError] = useState('');
  const [wardenSearchId, setWardenSearchId] = useState('');
  const [wardenStudent, setWardenStudent] = useState<Student | null>(null);
  const [wardenRedemptions, setWardenRedemptions] = useState<Redemption[]>([]);
  const [wardenSearchError, setWardenSearchError] = useState('');
  const [isWardenSearching, setIsWardenSearching] = useState(false);
  const [scannedToken, setScannedToken] = useState('');
  const [tokenResult, setTokenResult] = useState<any>(null);
  const [tokenVerifyError, setTokenVerifyError] = useState('');
  const [isVerifyingToken, setIsVerifyingToken] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState('');

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
            margin: 1, width: 200,
            color: { dark: '#0f172a', light: '#ffffff' }
          });
          urls[item.slot] = url;
        } catch (err) { }
      }
      setQrUrls(urls);
    }
    if (studentMealCodes.length > 0) generateQRs();
    else setQrUrls({});
  }, [studentMealCodes]);

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
      setBiometricMessage('✓ Device registered successfully!');
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

  // --- Utility ---
  const handleCopyCode = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const isSlotRedeemed = (slot: string, redemptionList: Redemption[]) => {
    return redemptionList.some((r) => r.mealSlot === slot);
  };

  // --- Warden Auth & Methods ---
  const handleWardenPinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (wardenPin === '1234') {
      setIsWardenAuthenticated(true);
      setWardenPinError('');
    } else {
      setWardenPinError('Invalid Warden PIN');
    }
  };

  const handleWardenExit = () => {
    setIsWardenAuthenticated(false);
    setWardenPin('');
  };

  const handleWardenStudentLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wardenSearchId || wardenSearchId.length !== 5) {
      setWardenSearchError('Enter a valid 5-digit Student ID.');
      return;
    }
    setIsWardenSearching(true);
    setWardenSearchError('');
    try {
      const res = await fetch(`/api/students?id=${wardenSearchId}&date=${currentDate}`, {
        headers: { 'x-warden-auth': '1234' }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setWardenStudent(data.student);
      setWardenRedemptions(data.redemptions);
    } catch (err: any) {
      setWardenSearchError(err.message || 'Network error.');
    } finally {
      setIsWardenSearching(false);
    }
  };

  const handleDirectRedemption = async (studentId: number, slot: string) => {
    setActionSuccessMessage('');
    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-warden-auth': '1234' },
        body: JSON.stringify({ studentId, date: currentDate, mealSlot: slot })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const updatedRes = await fetch(`/api/students?id=${studentId}&date=${currentDate}`, { headers: { 'x-warden-auth': '1234' } });
      const updatedData = await updatedRes.json();
      if (updatedRes.ok) {
        setWardenRedemptions(updatedData.redemptions);
      }
      setActionSuccessMessage(`Successfully checked in for slot ${slot}!`);
      setTimeout(() => setActionSuccessMessage(''), 4000);
    } catch (err: any) {
      alert(err.message || 'Redemption failed.');
    }
  };

  const handleTokenVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifyingToken(true);
    setTokenVerifyError('');
    try {
      const res = await fetch('/api/students/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-warden-auth': '1234' },
        body: JSON.stringify({ token: scannedToken.trim(), date: currentDate })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTokenResult(data);
    } catch (err: any) {
      setTokenVerifyError(err.message || 'Verification failed.');
    } finally {
      setIsVerifyingToken(false);
    }
  };

  const handleRedeemVerifiedToken = async () => {
    if (!tokenResult || !tokenResult.valid) return;
    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-warden-auth': '1234' },
        body: JSON.stringify({ studentId: tokenResult.student.studentId, date: currentDate, mealSlot: tokenResult.mealSlot })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setActionSuccessMessage(`Student checked in for ${tokenResult.mealName}.`);
      setTokenResult(null);
      setScannedToken('');
      setTimeout(() => setActionSuccessMessage(''), 4000);
    } catch (err: any) {
      alert(err.message || 'Network error.');
    }
  };

  // --- Components ---
  const SecuritySetupBlock = () => {
    return (
      <div className="glass-card p-5 rounded-2xl flex flex-col items-center text-center border border-primary-900/30 bg-primary-950/10 space-y-3">
        <div className="space-y-1">
          <h4 className="text-sm font-black text-primary-100 flex items-center justify-center gap-2">🔐 Passwordless Login</h4>
          <p className="text-xs text-primary-300/70">
            {!isSecureEnv ? 'Passkeys and Biometrics require a secure HTTPS connection. They are disabled on HTTP local networks.' : (hasBiometrics ? 'You have registered this device. You can register again if you face issues.' : 'Register this device to sign in instantly with Biometrics next time.')}
          </p>
        </div>
        <button onClick={handleRegisterBiometric} disabled={isRegisteringBiometric || !isSecureEnv} className={`w-full max-w-[200px] px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${!isSecureEnv ? 'bg-slate-800/50 text-slate-500 border border-slate-800/50 cursor-not-allowed' : 'bg-primary-900/50 hover:bg-primary-600 border border-primary-700/50 text-white cursor-pointer'}`}>
          {isRegisteringBiometric ? 'Registering...' : (hasBiometrics ? 'Re-register Device' : 'Register Passkey/Biometrics')}
        </button>
        {biometricMessage && <p className="text-[11px] text-emerald-400 font-bold bg-emerald-950/20 px-3 py-1.5 rounded-lg w-full">{biometricMessage}</p>}
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-slate-950 pb-24 text-slate-100 relative">
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-primary-500/5 rounded-full filter blur-[120px] -z-10 animate-pulse-slow"></div>
      <div className="absolute top-1/3 right-1/4 w-[400px] h-[400px] bg-purple-500/5 rounded-full filter blur-[100px] -z-10 animate-float"></div>

      {/* NAVBAR */}
      <nav className="sticky top-0 z-40 w-full glass border-b border-slate-900/60">
        <div className="max-w-md mx-auto px-4 h-16 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-950/40 rounded-xl border border-primary-900/30 text-primary-400">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </div>
            <div>
              <h1 className="text-sm font-black tracking-tight text-white leading-none">CampusByte</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-slate-900/80 p-1 rounded-xl border border-slate-800 flex">
              <button onClick={() => { setViewMode('student'); handleWardenExit(); }} className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${viewMode === 'student' ? 'bg-primary-600 text-white shadow' : 'text-slate-400'}`}>Portal</button>
              <button onClick={() => setViewMode('warden')} className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${viewMode === 'warden' ? 'bg-primary-600 text-white shadow' : 'text-slate-400'}`}>Warden</button>
            </div>
          </div>
        </div>
      </nav>

      {/* --- STUDENT PORTAL --- */}
      {viewMode === 'student' && (
        <section className="max-w-md mx-auto px-4 mt-8">

          {authStep === 'id' && (
            <div className="glass-card w-full p-6 sm:p-8 rounded-3xl space-y-6 text-left animate-fade-in shadow-xl">
              <div className="text-center pb-2">
                <h3 className="text-2xl font-black text-white">Meal Portal</h3>
                <p className="text-xs text-slate-400 mt-1">Enter your 5-digit Student ID to continue.</p>
              </div>
              <form onSubmit={handleCheckId} className="space-y-4">
                <input type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={5} placeholder="Student ID" value={studentIdInput} onChange={(e) => setStudentIdInput(e.target.value.replace(/\D/g, ''))} className="w-full bg-slate-950 border border-slate-900 rounded-xl py-3.5 px-4 text-base focus:border-primary-500 font-black tracking-widest text-center text-slate-200" required />
                {authError && <p className="text-[11px] text-rose-400 font-bold bg-rose-950/10 border border-rose-500/20 px-3 py-1.5 rounded-lg text-center">⚠️ {authError}</p>}
                <button type="submit" disabled={isAuthenticating} className="w-full gradient-btn text-white text-sm font-bold py-3.5 rounded-xl">{isAuthenticating ? 'Checking...' : 'Continue'}</button>
              </form>
            </div>
          )}

          {authStep === 'setup_password' && (
            <div className="glass-card w-full p-6 sm:p-8 rounded-3xl space-y-6 text-left animate-fade-in shadow-xl">
              <div>
                <h3 className="text-xl font-black text-white">Create Password</h3>
                <p className="text-xs text-slate-400 mt-1">Hi {studentName}, secure your meal passes by creating a strong password.</p>
                <ul className="text-[10px] text-slate-500 mt-3 space-y-1 font-medium bg-slate-900 p-3 rounded-xl border border-slate-800">
                  <li>✓ At least 8 characters</li>
                  <li>✓ Contains letters & numbers</li>
                  <li>✓ At least 1 special character (!@#$)</li>
                </ul>
              </div>
              <form onSubmit={handleSetupPassword} className="space-y-4">
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} placeholder="New Password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} className="w-full bg-slate-950 border border-slate-900 rounded-xl py-3.5 pl-4 pr-12 text-base focus:border-primary-500 text-slate-200" required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-3.5 text-slate-400 text-xs font-bold">{showPassword ? 'Hide' : 'Show'}</button>
                </div>
                {authError && <p className="text-[11px] text-rose-400 font-bold bg-rose-950/10 border border-rose-500/20 px-3 py-1.5 rounded-lg">⚠️ {authError}</p>}
                <button type="submit" disabled={isAuthenticating} className="w-full gradient-btn text-white text-sm font-bold py-3.5 rounded-xl">{isAuthenticating ? 'Setting up...' : 'Save & Sign In'}</button>
              </form>
            </div>
          )}

          {authStep === 'password' && (
            <div className="glass-card w-full p-6 sm:p-8 rounded-3xl space-y-6 text-left animate-fade-in shadow-xl">
              <div className="flex items-center gap-3 mb-2 bg-slate-900/50 p-3 rounded-2xl border border-slate-800">
                <div className="w-10 h-10 rounded-full bg-primary-900 flex items-center justify-center font-black text-primary-300">{studentName.charAt(0)}</div>
                <div>
                  <h3 className="text-sm font-black text-white">{studentName}</h3>
                  <p className="text-[10px] text-slate-500">ID: {studentIdInput}</p>
                </div>
              </div>
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} placeholder="Enter Password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} className="w-full bg-slate-950 border border-slate-900 rounded-xl py-3.5 pl-4 pr-12 text-base focus:border-primary-500 text-slate-200" required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-3.5 text-slate-400 text-xs font-bold">{showPassword ? 'Hide' : 'Show'}</button>
                </div>
                {authError && <p className="text-[11px] text-rose-400 font-bold bg-rose-950/10 border border-rose-500/20 px-3 py-1.5 rounded-lg text-center">⚠️ {authError}</p>}
                <button type="submit" disabled={isAuthenticating} className="w-full gradient-btn text-white text-sm font-bold py-3.5 rounded-xl">{isAuthenticating ? 'Logging in...' : 'Sign In'}</button>
              </form>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800"></div></div>
                <div className="relative flex justify-center"><span className="bg-slate-900/60 px-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest">OR</span></div>
              </div>

              <button onClick={handleBiometricLogin} disabled={isAuthenticating || !isSecureEnv} className={`w-full ${!isSecureEnv ? 'bg-slate-950 text-slate-600 cursor-not-allowed border-slate-900' : 'bg-slate-900 hover:bg-slate-800 text-white cursor-pointer border-slate-800'} border text-sm font-bold py-3.5 rounded-xl flex justify-center items-center gap-2 transition-colors`}>
                <span className={`text-lg ${!isSecureEnv ? 'opacity-50 grayscale' : ''}`}>🤳</span> {isSecureEnv ? 'Passkey / Biometrics' : 'Biometrics Require HTTPS'}
              </button>

              <button onClick={() => setAuthStep('id')} className="w-full text-[10px] text-slate-500 hover:text-slate-300 font-bold underline mt-2 cursor-pointer text-center">Not {studentName}?</button>
            </div>
          )}

          {authStep === 'logged_in' && activeStudent && (
            <div className="space-y-5 animate-fade-in">
              <div className="glass-card p-5 rounded-3xl flex justify-between items-center border-l-4 border-l-emerald-500 shadow-xl">
                <div className="space-y-1 text-left">
                  <h3 className="text-lg font-black text-white leading-tight">{activeStudent.name}</h3>
                  <p className="text-[10px] text-slate-500">ID: <span className="text-slate-300 font-bold">{activeStudent.studentId}</span></p>
                </div>
                <button onClick={handleStudentLogout} className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-slate-200 text-[10px] font-bold">Sign Out</button>
              </div>

              {!hasBiometrics && <SecuritySetupBlock />}

              {activeStudent.paidStatus !== 1 ? (
                <div className="bg-rose-950/20 border border-rose-500/25 p-6 rounded-3xl text-center space-y-4 shadow-xl">
                  <h4 className="text-sm font-black text-rose-400">Access Suspended</h4>
                  <p className="text-xs text-slate-400">Mess fee pending. Please clear your dues.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-left border-b border-slate-900 pb-2 flex justify-between items-end">
                    <h3 className="text-base font-black text-white">Daily Passes</h3>
                    <span className="text-[10px] text-primary-400 font-bold">{currentDate}</span>
                  </div>

                  <div className="grid gap-4 grid-cols-1">
                    {studentMealCodes.map((item, index) => {
                      const redeemed = isSlotRedeemed(item.slot, studentRedemptions);
                      const qrUrl = qrUrls[item.slot] || '';
                      return (
                        <div key={item.slot} className={`glass-card p-4 rounded-2xl flex items-center justify-between relative shadow-lg ${redeemed ? 'opacity-50' : 'border border-primary-900/30'}`}>
                          <div className="space-y-1.5 flex-1 pr-4">
                            <span className="text-xs text-slate-300 font-black uppercase tracking-wider">{item.name}</span>
                            <div className={`inline-block text-[9px] px-2 py-0.5 rounded font-black uppercase ${redeemed ? 'bg-slate-900 text-slate-500' : 'bg-emerald-500/10 text-emerald-400'}`}>
                              {redeemed ? 'Redeemed' : 'Active'}
                            </div>
                            <div className="pt-2">
                              <p className="text-[9px] font-black text-primary-400 font-mono truncate">{item.hash ? item.hash.substring(0, 16) + '...' : 'Generating...'}</p>
                            </div>
                          </div>

                          <div className="flex-shrink-0">
                            {qrUrl && (
                              <button disabled={redeemed} onClick={() => setSelectedQrCode({ name: item.name, hash: item.hash, url: qrUrl })} className={`p-1.5 bg-white rounded-xl shadow-md ${!redeemed && 'cursor-pointer hover:scale-105 transition-transform'}`}>
                                <img src={qrUrl} className="w-16 h-16 pointer-events-none" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {hasBiometrics && <div className="pt-6"><SecuritySetupBlock /></div>}
            </div>
          )}

          {/* QR Modal */}
          {selectedQrCode && (
            <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
              <div className="glass-card max-w-[320px] w-full p-6 rounded-3xl text-center space-y-5 relative border border-primary-500/30 shadow-2xl">
                <button onClick={() => setSelectedQrCode(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 bg-slate-900 rounded-full w-7 h-7 flex items-center justify-center cursor-pointer">✕</button>
                <div className="space-y-1"><h4 className="text-lg font-black text-white">{selectedQrCode.name} Pass</h4></div>
                <div className="flex justify-center bg-white p-3 rounded-2xl shadow-inner"><img src={selectedQrCode.url} className="w-48 h-48 pointer-events-none" /></div>
                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                  <p className="text-[10px] text-slate-500 uppercase font-black mb-1">Pass Code</p>
                  <p className="text-[11px] font-mono text-primary-400 break-all leading-tight">{selectedQrCode.hash}</p>
                </div>
                <button onClick={() => setSelectedQrCode(null)} className="w-full bg-slate-900 text-slate-300 text-xs font-bold py-3.5 rounded-xl cursor-pointer">Close Window</button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* --- WARDEN DASHBOARD --- */}
      {viewMode === 'warden' && (
        <section className="max-w-md mx-auto px-4 mt-8 text-left">
          {!isWardenAuthenticated ? (
            <div className="glass-card w-full p-8 rounded-3xl text-center space-y-6 shadow-xl">
              <h3 className="text-xl font-black text-white">Warden Auth</h3>
              <form onSubmit={handleWardenPinSubmit} className="space-y-4">
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} inputMode="numeric" pattern="[0-9]*" maxLength={4} placeholder="PIN (1234)" value={wardenPin} onChange={(e) => setWardenPin(e.target.value.replace(/\D/g, ''))} className="w-full text-center bg-slate-900 border border-slate-800 rounded-xl py-3 pl-4 pr-12 text-xl tracking-[0.5em] font-black focus:border-primary-500 text-white" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-4 text-slate-400 text-xs font-bold">{showPassword ? 'Hide' : 'Show'}</button>
                </div>
                {wardenPinError && <p className="text-[11px] text-rose-400">{wardenPinError}</p>}
                <button type="submit" className="w-full gradient-btn text-white text-sm font-bold py-3.5 rounded-xl">Authorize</button>
              </form>
            </div>
          ) : (
            <div className="space-y-5 animate-fade-in">
              <div className="glass-card p-5 rounded-3xl flex justify-between items-center shadow-lg">
                <h3 className="text-base font-black text-white">Warden Console</h3>
                <button onClick={handleWardenExit} className="bg-slate-900 text-slate-300 px-3 py-1.5 rounded-lg text-xs font-bold">Exit</button>
              </div>

              <div className="space-y-5">
                <div className="glass-card p-5 rounded-3xl space-y-4 shadow-lg">
                  <h4 className="text-sm font-black text-white">Scan Token</h4>
                  <form onSubmit={handleTokenVerification} className="space-y-3">
                    <input type="text" placeholder="Paste Pass Code" value={scannedToken} onChange={(e) => setScannedToken(e.target.value)} className="w-full bg-slate-950 border border-slate-900 rounded-xl px-4 py-3 text-base font-mono" />
                    <button type="submit" className="w-full bg-primary-600 text-white py-3 rounded-xl text-sm font-bold">Verify Code</button>
                  </form>
                  {tokenResult && (
                    <div className="mt-4 p-4 rounded-2xl bg-slate-900/50 border border-slate-800 space-y-3">
                      <p className="text-xs text-white"><strong>Student:</strong> {tokenResult.student.name} ({tokenResult.student.studentId})</p>
                      <p className="text-xs text-white"><strong>Slot:</strong> {tokenResult.mealName}</p>
                      {tokenResult.valid && !tokenResult.redeemed ? (
                        <button onClick={handleRedeemVerifiedToken} className="w-full bg-emerald-600 text-white text-xs font-black py-3 rounded-xl shadow-lg shadow-emerald-900/20">Approve Meal</button>
                      ) : (
                        <p className="text-xs text-rose-400 font-bold bg-rose-950/30 p-2 rounded-lg text-center">Already Redeemed or Invalid</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="glass-card p-5 rounded-3xl space-y-4 shadow-lg">
                  <h4 className="text-sm font-black text-white">Manual Check-In</h4>
                  <form onSubmit={handleWardenStudentLookup} className="flex gap-2">
                    <input type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={5} placeholder="Student ID" value={wardenSearchId} onChange={(e) => setWardenSearchId(e.target.value.replace(/\D/g, ''))} className="w-full bg-slate-950 border border-slate-900 rounded-xl px-4 py-3 text-base font-black tracking-widest text-center" />
                    <button type="submit" className="bg-primary-600 text-white px-5 rounded-xl text-sm font-bold">Search</button>
                  </form>
                  {wardenStudent && (
                    <div className="mt-4 space-y-3 bg-slate-900/40 p-4 rounded-2xl border border-slate-800">
                      <p className="text-sm font-black text-white">{wardenStudent.name}</p>
                      {['01', '02', '03'].map(slot => {
                        const redeemed = isSlotRedeemed(slot, wardenRedemptions);
                        return (
                          <div key={slot} className="flex justify-between items-center p-2.5 bg-slate-950/60 border border-slate-900 rounded-xl">
                            <span className="text-xs font-bold text-slate-300">{slot === '01' ? 'Breakfast' : slot === '02' ? 'Lunch' : 'Dinner'}</span>
                            {redeemed ? <span className="text-[10px] text-slate-500 font-black uppercase">Redeemed</span> : <button onClick={() => handleDirectRedemption(wardenStudent.studentId, slot)} className="text-[10px] bg-primary-900/80 hover:bg-primary-600 text-white px-4 py-1.5 rounded-lg font-bold transition-colors">Check In</button>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
