'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { User } from '@supabase/supabase-js';
import { Flame, Play, Trophy, Users, CheckCircle2, KeyRound, User as UserIcon } from 'lucide-react';

export default function LandingPage() {
  const router = useRouter();
  const supabase = createClient();

  // Host Auth State
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [currentHost, setCurrentHost] = useState<User | null>(null);

  const [pin, setPin] = useState('');
  const [nickname, setNickname] = useState('');
  const [teamName, setTeamName] = useState('');
  const [isTeamQuiz, setIsTeamQuiz] = useState(false);
  const [playLoading, setPlayLoading] = useState(false);

  // Check if Team Mode is enabled when a 6-digit PIN is inputted
  useEffect(() => {
    const checkTeamMode = async () => {
      if (pin.length === 6) {
        const { data: session } = await supabase
          .from('game_sessions')
          .select('id, quizzes(team_mode)')
          .eq('pin', pin)
          .maybeSingle();

        const sessionWithQuiz = session as unknown as { quizzes: { team_mode: boolean } | null };
        if (sessionWithQuiz?.quizzes?.team_mode) {
          setIsTeamQuiz(true);
        } else {
          setIsTeamQuiz(false);
        }
      } else {
        setIsTeamQuiz(false);
      }
    };
    checkTeamMode();
  }, [pin, supabase]);

  useEffect(() => {
    // Check if host is already logged in
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        setCurrentHost(data.session.user);
      }
    };
    checkSession();
  }, [supabase]);

  // Handle Host Auth Submission
  const handleHostAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Please enter both email and password.');
      return;
    }
    setAuthLoading(true);

    try {
      if (authMode === 'login') {
        const { error, data } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('Successfully logged in!');
        setCurrentHost(data.user);
        router.push('/dashboard');
      } else {
        if (!displayName) {
          toast.error('Please enter a display name.');
          setAuthLoading(false);
          return;
        }
        const { error, data } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        
        if (data.session) {
          toast.success('Successfully signed up and logged in!');
          setCurrentHost(data.user);
          router.push('/dashboard');
        } else {
          toast.success('Sign up complete! Please check your email for verification.');
        }
      }
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Authentication failed. Please try again.';
      toast.error(message);
    } finally {
      setAuthLoading(false);
    }
  };

  // Handle Player Quick Join
  const handlePlayerJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || pin.length !== 6) {
      toast.error('Please enter a valid 6-digit game PIN.');
      return;
    }
    if (!nickname.trim()) {
      toast.error('Please enter a nickname.');
      return;
    }
    if (isTeamQuiz && !teamName.trim()) {
      toast.error('Please enter a team name.');
      return;
    }
    setPlayLoading(true);

    try {
      // Find game session by PIN
      const { data: session, error: sessionError } = await supabase
        .from('game_sessions')
        .select('id, status')
        .eq('pin', pin)
        .single();

      if (sessionError || !session) {
        toast.error('Game room not found. Check the PIN and try again.');
        setPlayLoading(false);
        return;
      }

      if (session.status === 'finished') {
        toast.error('This game has already finished.');
        setPlayLoading(false);
        return;
      }

      // Check if nickname already exists in this session
      const { data: existingPlayer } = await supabase
        .from('players')
        .select('id, client_token')
        .eq('session_id', session.id)
        .eq('nickname', nickname.trim())
        .maybeSingle();

      // Implement Reconnection Check / Duplicate check
      const clientToken = localStorage.getItem(`quizarena_token_${session.id}`);
      
      if (existingPlayer) {
        if (clientToken && existingPlayer.client_token === clientToken) {
          // Reconnect existing player
          toast.success(`Reconnected as ${nickname}!`);
          router.push(`/play/${session.id}`);
          return;
        } else {
          toast.error('Nickname already taken in this room.');
          setPlayLoading(false);
          return;
        }
      }

      // Generate a new client token for the player
      const newToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      
      const { error: joinError } = await supabase
        .from('players')
        .insert({
          session_id: session.id,
          nickname: nickname.trim(),
          team_name: isTeamQuiz ? teamName.trim() : null,
          client_token: newToken,
          connected: true
        });

      if (joinError) throw joinError;

      localStorage.setItem(`quizarena_token_${session.id}`, newToken);
      toast.success('Joined the lobby successfully!');
      router.push(`/play/${session.id}`);
    } catch (error) {
      console.error(error);
      toast.error('Failed to join game room. Please try again.');
    } finally {
      setPlayLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-950 font-sans text-slate-100 flex flex-col justify-between">
      {/* Background Decorative Gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-violet-900/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-rose-900/20 blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="container mx-auto px-6 py-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <div className="bg-gradient-to-tr from-violet-600 to-fuchsia-600 p-2.5 rounded-2xl shadow-lg shadow-violet-500/20 flex items-center justify-center animate-pulse">
            <Flame className="w-6 h-6 text-white" />
          </div>
          <span className="font-extrabold text-2xl tracking-tight bg-gradient-to-r from-violet-400 via-fuchsia-400 to-rose-400 bg-clip-text text-transparent">
            QuizArena
          </span>
        </div>

        {currentHost && (
          <Button
            variant="ghost"
            className="hover:bg-slate-900 border border-slate-800 rounded-xl"
            onClick={() => router.push('/dashboard')}
          >
            Go to Dashboard
          </Button>
        )}
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-12 grid md:grid-cols-12 gap-12 items-center flex-1 z-10">
        {/* Left column: Branding / Info */}
        <div className="md:col-span-7 flex flex-col gap-6 text-center md:text-left">
          <div className="inline-flex self-center md:self-start items-center gap-2 px-3.5 py-1.5 rounded-full border border-violet-500/30 bg-violet-950/40 text-violet-300 text-xs font-semibold tracking-wide">
            <Trophy className="w-3.5 h-3.5" /> Live Multiplayer Quiz Platform
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-none bg-gradient-to-b from-white to-slate-300 bg-clip-text text-transparent">
            Bring Your Live Audince <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-violet-400 via-fuchsia-500 to-rose-400 bg-clip-text text-transparent">
              To Life in Real-Time.
            </span>
          </h1>
          <p className="text-slate-400 text-lg max-w-xl self-center md:self-start">
            Host fully customizable quiz competitions. Connect up to 80 players from their phones instantly with zero setup or accounts.
          </p>

          {/* Stats Bar */}
          <div className="grid grid-cols-3 gap-6 pt-6 border-t border-slate-900 max-w-md self-center md:self-start w-full">
            <div>
              <div className="text-2xl font-black text-white">80+</div>
              <div className="text-xs text-slate-500 font-medium">Players/Session</div>
            </div>
            <div>
              <div className="text-2xl font-black text-white">&lt; 100ms</div>
              <div className="text-xs text-slate-500 font-medium">Sync Latency</div>
            </div>
            <div>
              <div className="text-2xl font-black text-white">5+</div>
              <div className="text-xs text-slate-500 font-medium">Question Types</div>
            </div>
          </div>
        </div>

        {/* Right column: Action Panel */}
        <div className="md:col-span-5 flex flex-col gap-6 w-full max-w-md mx-auto">
          <Tabs defaultValue="player" className="w-full">
            <TabsList className="grid grid-cols-2 w-full bg-slate-900/60 border border-slate-800/80 p-1.5 rounded-2xl h-14 backdrop-blur-xl">
              <TabsTrigger
                value="player"
                className="rounded-xl font-black text-xs transition-all duration-300 data-active:bg-gradient-to-r data-active:from-violet-600 data-active:to-fuchsia-600 data-active:text-white data-active:shadow-lg data-active:shadow-violet-500/20"
              >
                Join as Player
              </TabsTrigger>
              <TabsTrigger
                value="host"
                className="rounded-xl font-black text-xs transition-all duration-300 data-active:bg-gradient-to-r data-active:from-violet-600 data-active:to-fuchsia-600 data-active:text-white data-active:shadow-lg data-active:shadow-violet-500/20"
              >
                Host Portal
              </TabsTrigger>
            </TabsList>

            {/* Player View */}
            <TabsContent value="player" className="mt-4">
              <Card className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-xl shadow-2xl rounded-3xl relative overflow-hidden">
                <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-500" />
                <CardHeader className="text-center pt-8 pb-4">
                  <CardTitle className="text-2xl font-black flex items-center justify-center gap-2 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                    <Play className="w-5 h-5 text-fuchsia-500 fill-fuchsia-500 animate-pulse" /> Enter Game Arena
                  </CardTitle>
                  <CardDescription className="text-slate-400 text-xs">
                    Get your PIN from the presenter&apos;s screen.
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-6 pb-8">
                  <form onSubmit={handlePlayerJoin} className="space-y-5">
                    <div className="space-y-1.5">
                      <Label htmlFor="pin" className="text-slate-400 font-extrabold text-[10px] uppercase tracking-wider pl-1">
                        <KeyRound className="w-3 h-3 inline-block mr-1" /> Game PIN
                      </Label>
                      <Input
                        id="pin"
                        placeholder="123456"
                        maxLength={6}
                        type="text"
                        pattern="[0-9]*"
                        inputMode="numeric"
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                        className="bg-slate-950/60 border-slate-850 h-12 text-center text-2xl font-black tracking-widest focus-visible:ring-violet-500 focus-visible:border-violet-500 rounded-xl transition-all"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="nickname" className="text-slate-400 font-extrabold text-[10px] uppercase tracking-wider pl-1 flex items-center gap-1">
                        <UserIcon className="w-3 h-3" /> Nickname
                      </Label>
                      <Input
                        id="nickname"
                        placeholder="E.g. SuperPlayer"
                        maxLength={15}
                        type="text"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        className="bg-slate-950/60 border-slate-850 h-12 text-center text-lg font-bold focus-visible:ring-violet-500 focus-visible:border-violet-500 rounded-xl transition-all"
                      />
                    </div>
                    {isTeamQuiz && (
                      <div className="space-y-1.5 animate-scale-in">
                        <Label htmlFor="teamName" className="text-amber-400 font-extrabold text-[10px] uppercase tracking-wider pl-1 flex items-center gap-1">
                          <Users className="w-3 h-3" /> Team Name
                        </Label>
                        <Input
                          id="teamName"
                          placeholder="E.g. The Einsteiners"
                          maxLength={20}
                          type="text"
                          value={teamName}
                          onChange={(e) => setTeamName(e.target.value)}
                          className="bg-slate-950/60 border-slate-850 h-12 text-center text-lg font-bold focus-visible:ring-violet-500 focus-visible:border-violet-500 rounded-xl transition-all"
                        />
                      </div>
                    )}
                    <Button
                      type="submit"
                      disabled={playLoading}
                      className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold h-12 rounded-xl text-base shadow-lg shadow-violet-500/20 hover:shadow-violet-500/35 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 duration-300"
                    >
                      {playLoading ? 'Joining...' : 'Ready to Play!'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Host View */}
            <TabsContent value="host" className="mt-4">
              <Card className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-xl shadow-2xl rounded-3xl relative overflow-hidden">
                <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-500" />
                <CardHeader className="text-center pt-8 pb-4">
                  <CardTitle className="text-2xl font-black flex items-center justify-center gap-2 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                    <Users className="w-5 h-5 text-violet-500" /> Host Control Panel
                  </CardTitle>
                  <CardDescription className="text-slate-400 text-xs">
                    Create quizzes, launch games, and manage scoreboards.
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-6 pb-8">
                  {currentHost ? (
                    <div className="space-y-4 text-center">
                      <div className="p-4 bg-slate-950/60 border border-slate-850 rounded-2xl flex flex-col items-center gap-2">
                        <CheckCircle2 className="w-8 h-8 text-emerald-500 animate-pulse" />
                        <p className="font-semibold text-sm text-slate-300">
                          Logged in as {currentHost.email}
                        </p>
                      </div>
                      <Button
                        onClick={() => router.push('/dashboard')}
                        className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold h-12 rounded-xl text-base shadow-lg shadow-violet-500/20 hover:shadow-violet-500/35 transition-all hover:scale-[1.01] active:scale-[0.99] duration-300"
                      >
                        Enter Dashboard
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          await supabase.auth.signOut();
                          setCurrentHost(null);
                          toast.success('Logged out successfully.');
                        }}
                        className="w-full border border-slate-850 hover:bg-slate-950 hover:text-white rounded-xl text-sm"
                      >
                        Log Out
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={handleHostAuth} className="space-y-4">
                      {authMode === 'signup' && (
                        <div className="space-y-1.5">
                          <Label htmlFor="displayName" className="text-slate-400 font-extrabold text-[10px] uppercase tracking-wider pl-1">
                            Display Name
                          </Label>
                          <Input
                            id="displayName"
                            placeholder="Mr. Presenter"
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            className="bg-slate-950/60 border-slate-850 h-11 focus-visible:ring-violet-500 rounded-xl"
                          />
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label htmlFor="email" className="text-slate-400 font-extrabold text-[10px] uppercase tracking-wider pl-1">
                          Email Address
                        </Label>
                        <Input
                          id="email"
                          placeholder="host@quizarena.com"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="bg-slate-950/60 border-slate-850 h-11 focus-visible:ring-violet-500 rounded-xl"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="password" className="text-slate-400 font-extrabold text-[10px] uppercase tracking-wider pl-1">
                          Password
                        </Label>
                        <Input
                          id="password"
                          placeholder="••••••••"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="bg-slate-950/60 border-slate-850 h-11 focus-visible:ring-violet-500 rounded-xl"
                        />
                      </div>

                      <Button
                        type="submit"
                        disabled={authLoading}
                        className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold h-12 rounded-xl text-base shadow-lg shadow-violet-500/20 hover:shadow-violet-500/35 transition-all hover:scale-[1.01] active:scale-[0.99] duration-300 mt-2"
                      >
                        {authLoading ? 'Please wait...' : authMode === 'login' ? 'Host Login' : 'Host Sign Up'}
                      </Button>

                      <div className="text-center pt-2">
                        <button
                          type="button"
                          onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
                          className="text-xs text-violet-400 hover:text-violet-300 font-semibold underline underline-offset-4"
                        >
                          {authMode === 'login'
                            ? "Don't have an account? Sign Up"
                            : 'Already have an account? Log In'}
                        </button>
                      </div>
                    </form>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* Footer */}
      <footer className="container mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between border-t border-slate-900 text-slate-500 text-xs z-10">
        <div>&copy; {new Date().getFullYear()} QuizArena. All rights reserved.</div>
        <div className="flex gap-4 mt-2 sm:mt-0">
          <a href="#" className="hover:underline">Terms of Service</a>
          <a href="#" className="hover:underline">Privacy Policy</a>
        </div>
      </footer>
    </div>
  );
}
