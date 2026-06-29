'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Scanner } from '@yudiel/react-qr-scanner';
import { toast } from 'sonner';

interface Warden {
  id: number;
  username: string;
  name: string;
}

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
  student?: { name: string };
  warden?: { name: string; username: string } | null;
}

export default function WardenDashboard() {
  const router = useRouter();

  // Auth state
  const [warden, setWarden] = useState<Warden | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [currentDate, setCurrentDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Metrics
  const [metrics, setMetrics] = useState({ breakfast: 0, lunch: 0, dinner: 0, total: 0 });
  const [recentRedemptions, setRecentRedemptions] = useState<Redemption[]>([]);

  // Verification Mode & Scanner
  const [verificationMethod, setVerificationMethod] = useState<'camera' | 'paste'>('camera');
  const [isScanning, setIsScanning] = useState(false);
  const [confirmingCode, setConfirmingCode] = useState<string | null>(null);

  // Token Verification
  const [scannedToken, setScannedToken] = useState('');
  const [tokenResult, setTokenResult] = useState<any>(null);
  const [isVerifyingToken, setIsVerifyingToken] = useState(false);

  // Manual Check-in
  const [searchId, setSearchId] = useState('');
  const [searchStudent, setSearchStudent] = useState<Student | null>(null);
  const [searchRedemptions, setSearchRedemptions] = useState<Redemption[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Daily Menu
  const [menuBreakfast, setMenuBreakfast] = useState('');
  const [menuLunch, setMenuLunch] = useState('');
  const [menuDinner, setMenuDinner] = useState('');
  const [isSavingMenu, setIsSavingMenu] = useState(false);

  const fetchMetrics = async (date: string) => {
    try {
      const res = await fetch(`/api/warden/metrics?date=${date}`);
      if (res.ok) {
        const data = await res.json();
        setMetrics(data.metrics);
        setRecentRedemptions(data.recentRedemptions);
      }
    } catch (err) {
      console.error('Error fetching metrics', err);
    }
  };

  const fetchMenu = async (date: string) => {
    try {
      const res = await fetch(`/api/warden/menu?date=${date}`);
      if (res.ok) {
        const data = await res.json();
        setMenuBreakfast(data.menu?.breakfast || '');
        setMenuLunch(data.menu?.lunch || '');
        setMenuDinner(data.menu?.dinner || '');
      }
    } catch (err) {
      console.error('Error fetching menu', err);
    }
  };

  // Check auth and set date
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/warden/check');
        const data = await res.json();
        if (res.ok && data.authenticated) {
          setWarden(data.warden);
          fetchMetrics(currentDate);
          fetchMenu(currentDate);
        } else {
          router.push('/warden/login');
        }
      } catch (err) {
        router.push('/warden/login');
      } finally {
        setCheckingAuth(false);
      }
    }
    checkAuth();
  }, [router, currentDate]);

  // Poll metrics every 15 seconds to keep dashboard updated
  useEffect(() => {
    if (!warden || !currentDate) return;
    const interval = setInterval(() => {
      fetchMetrics(currentDate);
    }, 15000);
    return () => clearInterval(interval);
  }, [warden, currentDate]);

  const handleLogout = async () => {
    await fetch('/api/auth/warden/logout', { method: 'POST' });
    router.push('/warden/login');
  };

  const autoVerifyToken = async (token: string) => {
    setIsVerifyingToken(true);
    setTokenResult(null);

    try {
      const res = await fetch('/api/students/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), date: currentDate })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      setTokenResult(data);
    } catch (err: any) {
      toast.error(err.message || 'Verification failed');
    } finally {
      setIsVerifyingToken(false);
    }
  };

  const handleTokenVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scannedToken.trim()) return;
    await autoVerifyToken(scannedToken);
  };

  const handleRedeemToken = async () => {
    if (!tokenResult || !tokenResult.valid) return;
    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: tokenResult.student.studentId,
          date: currentDate,
          mealSlot: tokenResult.mealSlot
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success(`Checked in for ${tokenResult.mealName}`);
      setTokenResult(null);
      setScannedToken('');
      setConfirmingCode(null);
      fetchMetrics(currentDate);
    } catch (err: any) {
      toast.error(err.message || 'Check-in failed');
    }
  };

  const handleStudentSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchId || searchId.length !== 5) {
      toast.error('Enter a valid 5-digit Student ID.');
      return;
    }

    setIsSearching(true);
    setSearchStudent(null);
    setSearchRedemptions([]);

    try {
      const res = await fetch(`/api/students?id=${searchId}&date=${currentDate}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      setSearchStudent(data.student);
      setSearchRedemptions(data.redemptions);
    } catch (err: any) {
      toast.error(err.message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleDirectRedeem = async (studentId: number, slot: string) => {
    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, date: currentDate, mealSlot: slot })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Refresh lookup
      const lookupRes = await fetch(`/api/students?id=${studentId}&date=${currentDate}`);
      const lookupData = await lookupRes.json();
      if (lookupRes.ok) {
        setSearchRedemptions(lookupData.redemptions);
      }

      toast.success(`Checked in for ${slot === '01' ? 'Breakfast' : slot === '02' ? 'Lunch' : 'Dinner'}`);
      fetchMetrics(currentDate);
    } catch (err: any) {
      toast.error(err.message || 'Direct redemption failed');
    }
  };

  const handleSaveMenu = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingMenu(true);
    try {
      const res = await fetch('/api/warden/menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: currentDate,
          breakfast: menuBreakfast,
          lunch: menuLunch,
          dinner: menuDinner
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save menu');
      toast.success('Menu saved successfully');
    } catch (err: any) {
      toast.error(err.message || 'Error saving menu');
    } finally {
      setIsSavingMenu(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-100 font-bold text-lg">
        Verifying session...
      </div>
    );
  }

  if (!warden) return null;

  return (
    <main className="min-h-screen pb-24 text-zinc-100 relative overflow-hidden font-sans">
      <div className="max-w-6xl mx-auto px-4 pt-6 flex justify-between items-center gap-4">
        <span className="text-sm text-zinc-400 font-medium">Active: {warden.name}</span>
        <button onClick={handleLogout} className="px-4 py-2 bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 rounded-lg text-zinc-300 hover:text-white text-xs font-bold transition-colors cursor-pointer">
          Sign Out
        </button>
      </div>

      <section className="max-w-6xl mx-auto px-4 mt-8 space-y-8">
        {/* HEADER */}
        <div className="flex flex-col gap-4 border-b border-zinc-900 pb-6">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white font-sans">Warden Dashboard.</h1>
            <p className="text-xs text-zinc-500 mt-1 font-medium">
              Live statistics, resets every day.
            </p>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">
              Date: <span className="text-zinc-200 font-bold">{currentDate}</span>
            </p>
          </div>
        </div>

        {/* TWO COLUMN GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* VERIFICATIONS & MANUAL REDEMPTIONS */}
          <div className="lg:col-span-2 space-y-8">

            {/* PASS VERIFICATION */}
            <div className="glass-card p-8 rounded-3xl border border-zinc-800 shadow-lg space-y-6">
              <div className="flex flex-row justify-between items-center border-b border-zinc-800 pb-4">
                <h3 className="text-xl font-bold text-zinc-100">Verify QR Code</h3>
                <button
                  type="button"
                  onClick={() => {
                    const next = verificationMethod === 'camera' ? 'paste' : 'camera';
                    setVerificationMethod(next);
                    setIsScanning(false);
                    setConfirmingCode(null);
                    setTokenResult(null);
                  }}
                  className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  {verificationMethod === 'camera' ? 'Manual Entry' : 'Camera Scanner'}
                </button>
              </div>

              {/* CAMERA MODE SCANNER CONTAINER */}
              {verificationMethod === 'camera' && (
                <div className="space-y-6">
                  {!isScanning && !confirmingCode && !tokenResult && !isVerifyingToken && (
                    <div className="flex flex-col items-center justify-center p-10 bg-zinc-950/50 rounded-2xl border border-dashed border-zinc-700 text-center space-y-4">
                      <div className="p-4 bg-zinc-200 text-zinc-900 rounded-xl">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-8 h-8">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                        </svg>
                      </div>
                      <div className="space-y-1">
                        <p className="text-lg font-bold text-zinc-100">Scanner Standby</p>
                        <p className="text-sm text-zinc-400">Initialize the camera to scan student QR passes.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setTokenResult(null);
                          setConfirmingCode(null);
                          setIsScanning(true);
                        }}
                        className="px-6 py-3 bg-zinc-200 text-zinc-900 hover:bg-white rounded-xl text-sm font-bold transition-colors cursor-pointer shadow-lg mt-2"
                      >
                        Activate Camera
                      </button>
                    </div>
                  )}

                  {isScanning && (
                    <div className="space-y-6 animate-fade-in">
                      <div className="relative overflow-hidden rounded-3xl bg-zinc-950 aspect-square max-w-sm mx-auto flex items-center justify-center border border-zinc-800 shadow-xl">
                        <Scanner
                          onScan={(result) => {
                            if (result && result.length > 0) {
                              setIsScanning(false);
                              setConfirmingCode(result[0].rawValue);
                            }
                          }}
                          onError={(error) => console.error("Scanner Error:", error?.message)}
                          sound={false}
                          components={{
                            finder: false,
                            zoom: false,
                            onOff: false,
                            torch: false
                          }}
                          styles={{
                            container: { width: '100%', height: '100%' },
                            video: { objectFit: 'cover' }
                          }}
                        />
                      </div>
                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={() => setIsScanning(false)}
                          className="px-6 py-3 bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-xl text-sm font-bold transition-colors cursor-pointer"
                        >
                          Cancel Scan
                        </button>
                      </div>
                    </div>
                  )}

                  {confirmingCode && !tokenResult && !isVerifyingToken && (
                    <div className="space-y-6 animate-fade-in">
                      <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800 text-center space-y-3">
                        <p className="text-sm text-zinc-400 font-bold">Scanned Pass Hash</p>
                        <p className="text-sm font-mono text-zinc-200 break-all">{confirmingCode}</p>
                      </div>
                      <div className="flex gap-4">
                        <button onClick={() => { setConfirmingCode(null); setIsScanning(true); }} className="w-1/3 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-xl py-4 text-sm font-bold border border-zinc-700 cursor-pointer transition-colors">Discard</button>
                        <button onClick={() => { autoVerifyToken(confirmingCode); }} className="w-2/3 bg-zinc-200 text-zinc-900 hover:bg-white rounded-xl py-4 text-sm font-bold shadow-lg cursor-pointer transition-colors">Authorize Pass</button>
                      </div>
                    </div>
                  )}

                  {isVerifyingToken && (
                    <div className="p-10 text-center bg-zinc-950 rounded-2xl border border-zinc-800">
                      <p className="text-zinc-200 text-base font-bold animate-pulse">Authenticating with server...</p>
                    </div>
                  )}
                </div>
              )}

              {/* PASTE CODE MODE CONTAINER */}
              {verificationMethod === 'paste' && (
                <form onSubmit={handleTokenVerify} className="space-y-4">
                  <input
                    type="text"
                    placeholder="Enter pass hash code"
                    value={scannedToken}
                    onChange={(e) => setScannedToken(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-4 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:border-zinc-500"
                  />
                  <button
                    type="submit"
                    disabled={isVerifyingToken || !scannedToken}
                    className="w-full bg-zinc-200 text-zinc-900 disabled:bg-zinc-900 disabled:text-zinc-600 py-4 rounded-xl text-sm font-bold transition-colors cursor-pointer"
                  >
                    {isVerifyingToken ? 'Verifying...' : 'Authorize Hash'}
                  </button>
                </form>
              )}

              {tokenResult && (
                <div className="p-6 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-4 animate-fade-in">
                  <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
                    <div>
                      <p className="text-lg font-bold text-zinc-100">{tokenResult.student.name}</p>
                      <p className="text-sm text-zinc-400 mt-1">ID: {tokenResult.student.studentId}</p>
                    </div>
                    <span className="text-sm bg-zinc-200 text-zinc-900 px-3 py-1 rounded-md font-bold">
                      {tokenResult.mealName}
                    </span>
                  </div>

                  {tokenResult.valid && !tokenResult.redeemed ? (
                    <div className="space-y-4 pt-2">
                      <p className="text-sm text-emerald-400 font-bold text-center">
                        Pass is valid and ready for redemption.
                      </p>
                      <button
                        onClick={handleRedeemToken}
                        className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-base font-bold py-4 rounded-xl shadow-lg transition-colors cursor-pointer"
                      >
                        Approve Meal
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-red-100 font-medium bg-red-950/50 border border-red-900 p-4 rounded-xl text-center mt-2">
                      {tokenResult.redeemed ? 'This pass has already been redeemed.' : 'Invalid or expired hash.'}
                    </p>
                  )}
                  <div className="pt-2 text-center">
                    <button onClick={() => { setTokenResult(null); if (verificationMethod === 'camera') setIsScanning(true); }} className="text-sm text-zinc-400 hover:text-zinc-200 font-medium underline cursor-pointer">
                      Clear and scan next
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* MANUAL CHECK-IN */}
            <div className="glass-card p-8 rounded-3xl border border-zinc-800 shadow-lg space-y-6">
              <h3 className="text-xl font-bold text-zinc-100">Directory Search</h3>
              <form onSubmit={handleStudentSearch} className="flex gap-3">
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={5}
                  placeholder="Student ID (e.g. 10001)"
                  value={searchId}
                  onChange={(e) => setSearchId(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-4 text-base font-bold text-center text-zinc-100 placeholder-zinc-600 focus:border-zinc-500"
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  className="bg-zinc-200 hover:bg-white text-zinc-900 px-8 rounded-xl text-sm font-bold transition-colors cursor-pointer"
                >
                  {isSearching ? '...' : 'Search'}
                </button>
              </form>

              {searchStudent && (
                <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-800 space-y-5 animate-fade-in">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-lg font-bold text-zinc-100">{searchStudent.name}</p>
                      <p className="text-sm text-zinc-400 mt-1">ID: {searchStudent.studentId}</p>
                    </div>
                    <span className={`text-xs px-3 py-1 rounded-md font-bold uppercase tracking-wider ${searchStudent.paidStatus === 1 ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900' : 'bg-red-950/40 border border-red-900 text-red-400'}`}>
                      {searchStudent.paidStatus === 1 ? 'Cleared' : 'Suspended'}
                    </span>
                  </div>

                  {searchStudent.paidStatus !== 1 ? (
                    <p className="text-sm text-red-100 font-medium text-center bg-red-950/50 p-4 rounded-xl border border-red-900">
                      Check-in blocked. Meal access is suspended due to pending fees.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 pt-2">
                      {['01', '02', '03'].map(slot => {
                        const redeemed = searchRedemptions.some(r => r.mealSlot === slot);
                        const label = slot === '01' ? 'Breakfast' : slot === '02' ? 'Lunch' : 'Dinner';
                        return (
                          <div key={slot} className="flex justify-between items-center p-4 bg-zinc-900 border border-zinc-800 rounded-xl">
                            <span className="text-sm font-bold text-zinc-100">{label}</span>
                            {redeemed ? (
                              <span className="text-xs text-zinc-500 font-bold uppercase px-4 py-2">Redeemed</span>
                            ) : (
                              <button
                                onClick={() => handleDirectRedeem(searchStudent.studentId, slot)}
                                className="text-xs bg-zinc-200 hover:bg-white text-zinc-900 px-5 py-2.5 rounded-lg font-bold transition-colors cursor-pointer"
                              >
                                Override Check-in
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* TODAY'S MENU */}
            <div className="glass-card p-8 rounded-3xl border border-zinc-800 shadow-lg space-y-6">
              <h3 className="text-xl font-bold text-zinc-100">Today&apos;s Menu</h3>
              <form onSubmit={handleSaveMenu} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-zinc-400 block">Breakfast</label>
                  <input
                    type="text"
                    placeholder="e.g. Idli, Sambar, Chutney"
                    value={menuBreakfast}
                    onChange={(e) => setMenuBreakfast(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-4 text-base font-bold text-zinc-100 placeholder-zinc-600 focus:border-zinc-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-zinc-400 block">Lunch</label>
                  <input
                    type="text"
                    placeholder="e.g. Rice, Dal, Chapati, Paneer"
                    value={menuLunch}
                    onChange={(e) => setMenuLunch(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-4 text-base font-bold text-zinc-100 placeholder-zinc-600 focus:border-zinc-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-zinc-400 block">Dinner</label>
                  <input
                    type="text"
                    placeholder="e.g. Fried Rice, Manchurian"
                    value={menuDinner}
                    onChange={(e) => setMenuDinner(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-5 py-4 text-base font-bold text-zinc-100 placeholder-zinc-600 focus:border-zinc-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSavingMenu}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-8 py-4 rounded-xl text-base font-bold transition-colors cursor-pointer mt-2"
                >
                  {isSavingMenu ? 'Saving...' : 'Save Menu'}
                </button>
              </form>
            </div>

          </div>

          {/* AUDITOR LOG */}
          <div className="glass-card p-8 rounded-3xl border border-zinc-800 shadow-lg space-y-6 flex flex-col h-full min-h-[500px]">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-4">
              <h3 className="text-xl font-bold text-zinc-100">Audit Log</h3>
              <span className="text-xs text-zinc-900 font-bold bg-zinc-200 px-3 py-1 rounded-md">Live</span>
            </div>

            <div className="space-y-4 overflow-y-auto flex-1 max-h-[600px] pr-2">
              {recentRedemptions.length === 0 ? (
                <p className="text-sm text-zinc-500 text-center py-12 font-medium">No redemptions logged today.</p>
              ) : (
                recentRedemptions.map((item) => {
                  const label = item.mealSlot === '01' ? 'Breakfast' : item.mealSlot === '02' ? 'Lunch' : 'Dinner';
                  const time = new Date(item.redeemedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return (
                    <div key={item.id} className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 text-left space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-bold text-zinc-100 truncate max-w-[160px]">
                          {item.student?.name || `ID: ${item.studentId}`}
                        </span>
                        <span className="text-xs border border-zinc-700 text-zinc-400 px-2 py-1 rounded-md font-medium">
                          {label}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs font-medium text-zinc-500">
                        <span>Time: <strong className="text-zinc-300">{time}</strong></span>
                        <span className="truncate max-w-[120px]">
                          Warden: <strong className="text-zinc-300">{item.warden?.username || 'Auto'}</strong>
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* METRICS ROW */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="glass-card p-5 rounded-2xl border border-zinc-800 shadow-md">
            <p className="text-xs font-bold text-zinc-400">Breakfast Served</p>
            <p className="text-3xl font-black text-zinc-100 mt-2">{metrics.breakfast}</p>
          </div>
          <div className="glass-card p-5 rounded-2xl border border-zinc-800 shadow-md">
            <p className="text-xs font-bold text-zinc-400">Lunch Served</p>
            <p className="text-3xl font-black text-zinc-100 mt-2">{metrics.lunch}</p>
          </div>
          <div className="glass-card p-5 rounded-2xl border border-zinc-800 shadow-md">
            <p className="text-xs font-bold text-zinc-400">Dinner Served</p>
            <p className="text-3xl font-black text-zinc-100 mt-2">{metrics.dinner}</p>
          </div>
          <div className="glass-card p-5 rounded-2xl border border-zinc-500 shadow-md">
            <p className="text-xs font-bold text-zinc-300">Total Served</p>
            <p className="text-3xl font-black text-zinc-100 mt-2">{metrics.total}</p>
          </div>
        </div>
      </section>

      <footer className="w-full text-center py-6 mt-8">
        <p className="text-lg font-normal font-pixel text-zinc-600">CampusBytes.</p>
      </footer>
    </main>
  );
}
