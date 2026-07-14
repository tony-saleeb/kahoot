'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Flame, Play, KeyRound, User, Users } from 'lucide-react';

export default function PlayerJoinPage() {
  const router = useRouter();
  const supabase = createClient();

  const [pin, setPin] = useState('');
  const [nickname, setNickname] = useState('');
  const [teamName, setTeamName] = useState('');
  const [isTeamQuiz, setIsTeamQuiz] = useState(false);
  const [loading, setLoading] = useState(false);

  // Read PIN query parameter from URL on load
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const pinParam = params.get('pin');
      if (pinParam) {
        setPin(pinParam.slice(0, 6).replace(/\D/g, ''));
      }
    }
  }, []);

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
    setLoading(true);

    try {
      // Run session lookup
      const sessionResult = await supabase
        .from('game_sessions')
        .select('id, status')
        .eq('pin', pin)
        .single();

      const { data: session, error: sessionError } = sessionResult;

      if (sessionError || !session) {
        toast.error('Game room not found. Check the PIN and try again.');
        setLoading(false);
        return;
      }

      if (session.status === 'finished') {
        toast.error('This game has already finished.');
        setLoading(false);
        return;
      }

      // Now check nickname + reconnect token in parallel
      const clientToken = localStorage.getItem(`quizarena_token_${session.id}`);
      const { data: existingPlayer } = await supabase
        .from('players')
        .select('id, client_token')
        .eq('session_id', session.id)
        .eq('nickname', nickname.trim())
        .maybeSingle();

      if (existingPlayer) {
        if (clientToken && existingPlayer.client_token === clientToken) {
          toast.success(`Reconnected as ${nickname}!`);
          router.replace(`/play/${session.id}`);
          return;
        } else {
          toast.error('Nickname already taken in this room.');
          setLoading(false);
          return;
        }
      }

      // Generate token and insert — single query
      const newToken = crypto.randomUUID();

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
      toast.success('Joined the lobby!');
      router.replace(`/play/${session.id}`);
    } catch (err: unknown) {
      console.error(err);
      toast.error('Failed to join game room. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-950 font-sans text-slate-100 flex flex-col justify-between items-center p-6">
      {/* Background Decorative Gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-violet-900/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-rose-900/10 blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="flex items-center gap-2 py-6 z-10 cursor-pointer" onClick={() => router.push('/play')}>
        <div className="bg-gradient-to-tr from-violet-600 to-fuchsia-600 p-2 rounded-xl flex items-center justify-center">
          <Flame className="w-5 h-5 text-white" />
        </div>
        <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-violet-400 via-fuchsia-400 to-rose-400 bg-clip-text text-transparent">
          QuizArena
        </span>
      </header>

      {/* Card Form */}
      <main className="w-full max-w-sm my-auto z-10">
        <Card className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-xl shadow-2xl rounded-3xl relative overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-500" />
          <CardHeader className="text-center pt-8 pb-4">
            <CardTitle className="text-2xl font-black flex items-center justify-center gap-2 bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
              <Play className="w-5 h-5 text-fuchsia-500 fill-fuchsia-500 animate-pulse" /> Enter Game Arena
            </CardTitle>
            <CardDescription className="text-slate-400 text-xs">
              Enter the room PIN and your nickname to participate.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-8">
            <form onSubmit={handlePlayerJoin} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="pin" className="text-slate-400 font-extrabold text-[10px] uppercase tracking-wider pl-1 flex items-center gap-1">
                  <KeyRound className="w-3 h-3" /> Game PIN
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
                  <User className="w-3 h-3" /> Nickname
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
                    className="bg-slate-950/60 border-slate-855 h-12 text-center text-lg font-bold focus-visible:ring-violet-500 focus-visible:border-violet-500 rounded-xl transition-all"
                  />
                </div>
              )}
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold h-12 rounded-xl text-base shadow-lg shadow-violet-500/20 hover:shadow-violet-500/35 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 duration-300"
              >
                {loading ? 'Joining...' : 'Ready to Play!'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="py-6 text-slate-500 text-[10px] z-10 text-center">
        <div>&copy; {new Date().getFullYear()} QuizArena. All rights reserved.</div>
      </footer>
    </div>
  );
}
