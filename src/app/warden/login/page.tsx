'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function WardenLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Fill all fields.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/warden/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      router.push('/warden');
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col justify-center items-center p-4 relative text-zinc-100 overflow-hidden font-sans">
      <div className="glass-card max-w-md w-full p-10 rounded-3xl space-y-8 shadow-2xl border border-zinc-800 animate-fade-in">
        <div className="text-center space-y-3 border-b border-zinc-800 pb-6">
          <h2 className="text-2xl font-bold text-zinc-100">Warden Login.</h2>
          <p className="text-sm text-zinc-400">Sign in to access dashboard.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1">
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-4 px-5 text-base font-medium focus:border-zinc-500 text-zinc-100"
              required
            />
          </div>

          <div className="space-y-1 relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-4 pl-5 pr-14 text-base font-medium focus:border-zinc-500 text-zinc-100"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-5 top-4 text-zinc-400 hover:text-zinc-200 text-xs font-bold transition-colors cursor-pointer"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-100 font-medium bg-red-950/50 border border-red-900 px-4 py-3 rounded-lg text-center">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full btn-zinc font-bold text-sm py-4 rounded-xl cursor-pointer"
          >
            {isLoading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
      </div>

      <footer className="absolute bottom-6 w-full text-center">
        <p className="text-lg font-normal font-pixel text-white">CampusByte.</p>
      </footer>
    </main>
  );
}
