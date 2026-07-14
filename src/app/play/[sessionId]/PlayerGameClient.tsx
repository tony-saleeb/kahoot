'use client';
// Force TS cache refresh

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { updatePlayerConnection } from '@/app/actions/game';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Flame, Wifi, WifiOff, Loader2, Award, CheckCircle, XCircle, Clock, Trophy, Pause, Check, Users, Zap } from 'lucide-react';
import { playCorrectSound, playIncorrectSound, playFanfareSound } from '@/lib/sounds';
import confetti from 'canvas-confetti';

interface Player {
  id: string;
  session_id: string;
  nickname: string;
  team_name?: string | null;
  score: number;
  streak: number;
  joined_at: string;
  connected: boolean;
}

interface AnswerOption {
  id: string;
  text: string;
  color: string;
  shape: string;
}

interface ActiveQuestionPayload {
  id: string;
  type: string;
  prompt: string;
  media_url: string | null;
  media_type: string | null;
  time_limit_seconds: number;
  answers: AnswerOption[];
}

interface PlayerGameClientProps {
  sessionId: string;
  initialSessionStatus: string;
  quizTheme?: Record<string, unknown> | null;
}

export default function PlayerGameClient({
  sessionId,
  initialSessionStatus,
  quizTheme,
}: PlayerGameClientProps) {
  const router = useRouter();
  const supabase = createClient();

  // State managers
  const [player, setPlayer] = useState<Player | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string>(initialSessionStatus);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [podiumPlayers, setPodiumPlayers] = useState<Player[]>([]);

  // Active question loop variables
  const [activeQuestion, setActiveQuestion] = useState<ActiveQuestionPayload | null>(null);
  const [selectedAnswerIds, setSelectedAnswerIds] = useState<string[]>([]);
  const [submissionState, setSubmissionState] = useState<'idle' | 'submitting' | 'submitted' | 'late'>('idle');
  const [typeInputValue, setTypeInputValue] = useState('');
  const [roundResult, setRoundResult] = useState<{
    isCorrect: boolean;
    pointsAwarded: number;
    correctAnswerIds: string[];
    optionCounts?: Record<string, number>;
  } | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [finalRank, setFinalRank] = useState<number | null>(null);
  const [activeMultiplier, setActiveMultiplier] = useState<number>(1);

  const playerRef = React.useRef<Player | null>(null);
  const activeQuestionRef = React.useRef<ActiveQuestionPayload | null>(null);

  React.useEffect(() => {
    playerRef.current = player;
  }, [player]);

  React.useEffect(() => {
    activeQuestionRef.current = activeQuestion;
  }, [activeQuestion]);

  const shapesMap: Record<string, string> = {
    triangle: '▲',
    diamond: '◆',
    circle: '●',
    square: '■',
    star: '★',
    hexagon: '⬢',
  };

  const customStyles = {
    backgroundColor: (quizTheme?.bgColor as string) || '#090f1d',
    color: (quizTheme?.textColor as string) || '#f1f5f9',
  };

  // 1. Authenticate player identity and check token on load
  useEffect(() => {
    const authenticatePlayer = async () => {
      const token = localStorage.getItem(`quizarena_token_${sessionId}`);
      if (!token) {
        toast.error('Session not found. Please join with your PIN.');
        router.push('/play');
        return;
      }

      try {
        const { data: playerRecord, error } = await supabase
          .from('players')
          .select('*')
          .eq('session_id', sessionId)
          .eq('client_token', token)
          .maybeSingle();

        if (error || !playerRecord) {
          localStorage.removeItem(`quizarena_token_${sessionId}`);
          toast.error('Identity verification failed. Please join again.');
          router.push('/play');
          return;
        }

        setPlayer(playerRecord as Player);
        setLoading(false);

        // Update connection status
        await updatePlayerConnection(playerRecord.id, token, true);
      } catch (err) {
        console.error('Authentication error:', err);
        router.push('/play');
      }
    };

    authenticatePlayer();
  }, [supabase, sessionId, router]);

  // 2. Realtime listener setup for status, kick actions, and broadcasts
  useEffect(() => {
    if (!player?.id) return;

    const token = localStorage.getItem(`quizarena_token_${sessionId}`) || '';
    const playerId = player.id;

    // Listen if host deletes our player row (kicking action)
    const playerChannel = supabase
      .channel(`player_self_${playerId}`)
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'players',
          filter: `id=eq.${playerId}`,
        },
        () => {
          localStorage.removeItem(`quizarena_token_${sessionId}`);
          toast.error('You have been kicked from the lobby by the host.');
          router.push('/play');
        }
      )
      .subscribe();

    // Listen to Game Session status changes
    const sessionChannel = supabase
      .channel(`player_session_${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'game_sessions',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const newStatus = payload.new.status;
          setSessionStatus(newStatus);

          // Handle resetting states during transitions
          if (newStatus === 'leaderboard') {
            setRoundResult(null);
          } else if (newStatus === 'finished') {
            fetchFinalRank();
          }
        }
      )
      .subscribe();

    // Listen to ephemeral Broadcast events (question starts & reveals)
    const broadcastChannel = supabase.channel(`session_channel_${sessionId}`);

    broadcastChannel
      .on('broadcast', { event: 'question:start' }, (payload) => {
        // Find corresponding question ID by fetching current session index
        const fetchQuestionDetails = async () => {
          // Fetch current question ID from the database using public query
          const { data: sessionData } = await supabase
            .from('game_sessions')
            .select('current_question_index, quiz_id')
            .eq('id', sessionId)
            .single();

          if (sessionData) {
            const { data: qData } = await supabase
              .from('questions')
              .select('id')
              .eq('quiz_id', sessionData.quiz_id)
              .eq('order_index', sessionData.current_question_index)
              .single();

            if (qData) {
              setActiveQuestion({
                id: qData.id,
                type: payload.payload.type,
                prompt: payload.payload.prompt,
                media_url: payload.payload.media_url,
                media_type: payload.payload.media_type,
                time_limit_seconds: payload.payload.time_limit_seconds,
                answers: payload.payload.answers,
              });

              // Synchronize countdown timer based on server starting timestamp
              const serverStartedAt = new Date(payload.payload.server_started_at || new Date().toISOString());
              const elapsedMs = new Date().getTime() - serverStartedAt.getTime();
              const elapsedSec = Math.floor(elapsedMs / 1000);
              const remaining = Math.max(0, payload.payload.time_limit_seconds - elapsedSec);
              setTimeLeft(remaining);

              setSelectedAnswerIds([]);
              setTypeInputValue('');
              setSubmissionState('idle');
              setRoundResult(null);
            }
          }
        };

        fetchQuestionDetails();
      })
      .on('broadcast', { event: 'question:reveal' }, (payload) => {
        // Reveal correct keys
        const correctIds = payload.payload.correct_answer_ids as string[];
        const optionCounts = payload.payload.option_counts as Record<string, number> | undefined;
        fetchRoundResults(correctIds, optionCounts);
      })
      .on('broadcast', { event: 'question:update' }, (payload) => {
        // Live question edit from host
        setActiveQuestion((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            prompt: payload.payload.prompt || prev.prompt,
            answers: payload.payload.answers
              ? prev.answers.map((ans) => {
                  const updated = (payload.payload.answers as { id: string; text: string }[]).find((a) => a.id === ans.id);
                  return updated ? { ...ans, text: updated.text } : ans;
                })
              : prev.answers,
          };
        });
        toast.info('The host updated the question.');
      })
      .on('broadcast', { event: 'host:announcement' }, (payload) => {
        // Host announcement toast
        const message = payload.payload.message as string;
        if (message) {
          toast.info(`📢 Host: ${message}`, { duration: 8000 });
        }
      })
      .on('broadcast', { event: 'multiplier:change' }, (payload) => {
        // Multiplier toggle from host
        const multiplier = (payload.payload.multiplier as number) || 1;
        setActiveMultiplier(multiplier);
        if (multiplier > 1) {
          toast.success(`⚡ Double Points activated! (${multiplier}x)`, { duration: 5000 });
        } else {
          toast.info('Multiplier deactivated (1x)');
        }
      })
      .subscribe();

    const fetchRoundResults = async (correctAnswerIds: string[], optionCounts?: Record<string, number>) => {
      // Query player submissions to get points awarded and correctness
      const currentActiveQuestion = activeQuestionRef.current;
      if (!currentActiveQuestion) return;

      const { data: subRecord } = await supabase
        .from('answers_submitted')
        .select('points_awarded, is_correct')
        .eq('session_id', sessionId)
        .eq('question_id', currentActiveQuestion.id)
        .eq('player_id', playerId)
        .maybeSingle();

      // Fetch player's updated score & streak
      const { data: updatedPlayer } = await supabase
        .from('players')
        .select('score, streak')
        .eq('id', playerId)
        .single();

      if (updatedPlayer) {
        setPlayer((prev) => prev ? { ...prev, score: updatedPlayer.score, streak: updatedPlayer.streak } : null);
      }

      const isCorrect = subRecord?.is_correct ?? false;
      if (isCorrect) {
        playCorrectSound();
      } else {
        playIncorrectSound();
      }

      setRoundResult({
        isCorrect,
        pointsAwarded: subRecord?.points_awarded ?? 0,
        correctAnswerIds,
        optionCounts,
      });
      setSubmissionState('idle');
    };

    const fetchFinalRank = async () => {
      const { data: allPlayers } = await supabase
        .from('players')
        .select('id, nickname, score')
        .eq('session_id', sessionId)
        .order('score', { ascending: false });

      if (allPlayers) {
        const rank = allPlayers.findIndex((p) => p.id === playerId) + 1;
        setFinalRank(rank);
        setPodiumPlayers(allPlayers as Player[]);
      }
    };

    // Connection Sync
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === 'visible';
      setOnline(isVisible);
      updatePlayerConnection(playerId, token, isVisible);
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', () => {
      setOnline(true);
      updatePlayerConnection(playerId, token, true);
    });
    window.addEventListener('blur', () => {
      setOnline(false);
      updatePlayerConnection(playerId, token, false);
    });

    return () => {
      supabase.removeChannel(playerChannel);
      supabase.removeChannel(sessionChannel);
      supabase.removeChannel(broadcastChannel);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [supabase, player?.id, sessionId, router]);

  // Countdown timer logic for player client
  useEffect(() => {
    if (sessionStatus !== 'question_active' || !activeQuestion || timeLeft <= 0) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionStatus, activeQuestion, timeLeft]);

  // 3. Trigger confetti and fanfare upon game completion (finished podium)
  useEffect(() => {
    if (sessionStatus === 'finished') {
      playFanfareSound();

      const duration = 5 * 1000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 5,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ['#a855f7', '#ec4899', '#3b82f6'],
        });
        confetti({
          particleCount: 5,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ['#a855f7', '#ec4899', '#3b82f6'],
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };
      frame();
    }
  }, [sessionStatus]);

  // Handle Answer Submission Call
  const submitAnswer = async (answersToSubmit: string[]) => {
    if (!player || !activeQuestion || submissionState !== 'idle') return;
    setSubmissionState('submitting');

    const token = localStorage.getItem(`quizarena_token_${sessionId}`) || '';

    try {
      const response = await fetch('/api/submit-answer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          playerId: player.id,
          token,
          questionId: activeQuestion.id,
          selectedAnswerIds: answersToSubmit,
          multiplier: activeMultiplier,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit answer.');
      }

      setSubmissionState('submitted');
      toast.success('Answer submitted successfully!');
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to submit.');
      setSubmissionState('idle');
    }
  };

  // Quick submit for MCQ & True/False (1 click)
  const handleChoiceTap = (choiceId: string) => {
    if (activeQuestion?.type === 'mcq' || activeQuestion?.type === 'true_false' || activeQuestion?.type === 'poll') {
      setSelectedAnswerIds([choiceId]);
      submitAnswer([choiceId]);
    }
  };

  // Toggle selection for Multi-select
  const handleCheckboxToggle = (choiceId: string) => {
    if (selectedAnswerIds.includes(choiceId)) {
      setSelectedAnswerIds(selectedAnswerIds.filter((id) => id !== choiceId));
    } else {
      setSelectedAnswerIds([...selectedAnswerIds, choiceId]);
    }
  };

  // Trigger Multi-select submit
  const handleMultiSubmit = () => {
    if (selectedAnswerIds.length === 0) {
      toast.error('Please select at least one choice.');
      return;
    }
    submitAnswer(selectedAnswerIds);
  };

  // Trigger text type-in submit
  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typeInputValue.trim()) {
      toast.error('Please type an answer before submitting.');
      return;
    }
    submitAnswer([typeInputValue.trim()]);
  };

  if (loading || !player) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100 font-sans">
        <Loader2 className="w-10 h-10 text-violet-500 animate-spin mb-4" />
        <p className="text-sm font-semibold text-slate-400">Verifying session token...</p>
      </div>
    );
  }

  // ==========================================
  // RENDER: LOBBY STATE (WAITING SCREEN)
  // ==========================================
  if (sessionStatus === 'lobby') {
    return (
      <div className="relative min-h-screen bg-slate-950 font-sans text-slate-100 flex flex-col justify-between items-center p-6 overflow-hidden" style={customStyles}>
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-violet-900/10 blur-[130px] pointer-events-none animate-pulse" />
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-rose-900/10 blur-[130px] pointer-events-none animate-pulse" />

        <header className="flex items-center gap-1.5 py-4 z-10">
          <div className="bg-gradient-to-tr from-violet-600 to-fuchsia-600 p-1.5 rounded-lg flex items-center justify-center">
            <Flame className="w-4 h-4 text-white" />
          </div>
          <span className="font-extrabold text-md tracking-tight bg-gradient-to-r from-violet-400 via-fuchsia-400 to-rose-400 bg-clip-text text-transparent">
            QuizArena
          </span>
        </header>

        <main className="w-full max-w-sm text-center my-auto z-10 flex flex-col items-center gap-6">
          <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-3xl w-full shadow-2xl backdrop-blur-md">
            <div className="flex justify-center mb-4">
              <span className={`px-3 py-1 rounded-full border text-[10px] font-bold flex items-center gap-1.5 ${
                online
                  ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400'
                  : 'border-rose-500/30 bg-rose-950/20 text-rose-400'
              }`}>
                {online ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                {online ? 'Connected' : 'Offline / Inactive'}
              </span>
            </div>
            
            <h2 className="text-xs uppercase font-extrabold text-slate-500 tracking-wider">
              You are in!
            </h2>
            <h1 className="text-3xl font-black text-white truncate max-w-[250px] mx-auto mt-1.5 mb-1">
              {player.nickname}
            </h1>
            {player.team_name && (
              <p className="text-sm font-extrabold text-amber-400 mb-6 bg-slate-950/60 border border-slate-800 px-3 py-1 rounded-full inline-flex items-center gap-1">
                <Users className="w-3.5 h-3.5" /> Team: {player.team_name}
              </p>
            )}

            <div className="py-4 border-t border-slate-950 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
              <p className="font-semibold text-sm text-slate-300">
                Waiting for the host to start...
              </p>
              <p className="text-slate-500 text-xs max-w-xs">
                Look at the main presenter screen. Your game will begin shortly!
              </p>
            </div>
          </div>
        </main>

        <footer className="py-4 text-slate-500 text-[9px] z-10 text-center">
          <div>QuizArena &copy; {new Date().getFullYear()}</div>
        </footer>
      </div>
    );
  }

  // ==========================================
  // RENDER: ROUND REVEAL RESULTS (CORRECT / INCORRECT STATE)
  // ==========================================
  if (roundResult && activeQuestion) {
    const isCorrect = roundResult.isCorrect;
    const points = roundResult.pointsAwarded;

    return (
      <div
        className={`min-h-screen w-full flex flex-col justify-between items-center p-6 text-center text-white font-sans transition-colors duration-500 ${
          isCorrect ? 'bg-emerald-600' : 'bg-rose-600'
        }`}
      >
        <div />

        <div className="space-y-4 animate-scale-in w-full max-w-sm">
          <div className="flex justify-center">
            {isCorrect ? (
              <CheckCircle className="w-20 h-20 text-white fill-emerald-500" />
            ) : (
              <XCircle className="w-20 h-20 text-white fill-rose-500" />
            )}
          </div>
          <h1 className="text-4xl sm:text-5xl font-black uppercase tracking-tight">
            {isCorrect ? 'Correct!' : 'Incorrect'}
          </h1>
          <p className="text-white/80 font-bold text-xl">
            {isCorrect ? `+${points.toLocaleString()} Points` : '+0 Points'}
          </p>
          {player.streak > 1 && isCorrect && (
            <div className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-white/20 border border-white/10 rounded-full text-sm font-extrabold animate-bounce">
              <Flame className="w-4 h-4 fill-current text-amber-300" />
              <span>Streak: {player.streak} answers!</span>
            </div>
          )}
        </div>

        {/* Choices Distribution Chart */}
        {(() => {
          const totalVotes = roundResult.optionCounts
            ? Object.values(roundResult.optionCounts).reduce((a, b) => a + b, 0)
            : 0;

          return roundResult.optionCounts ? (
            <div className="w-full max-w-sm bg-black/25 border border-white/10 rounded-3xl p-5 flex flex-col items-center gap-4 backdrop-blur-md my-2 animate-fade-in">
              <h3 className="text-[10px] uppercase font-black tracking-wider text-white/55">
                Answer Choices Distribution
              </h3>

              <div className="flex items-end justify-center gap-3.5 h-36 w-full px-2 border-b border-white/10 pb-1">
                {activeQuestion.answers.map((ans) => {
                  const votes = roundResult.optionCounts ? (roundResult.optionCounts[ans.id] || 0) : 0;
                  const ratio = totalVotes > 0 ? votes / totalVotes : 0;
                  const heightPercent = `${Math.max(8, ratio * 85)}%`;

                  const isCorrectOption = roundResult.correctAnswerIds.includes(ans.id);

                  return (
                    <div key={ans.id} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end select-none">
                      <span className="font-mono text-[10px] font-black text-white bg-slate-950/80 px-1.5 py-0.5 rounded border border-white/5">
                        {votes}
                      </span>
                      <div
                        className="w-full rounded-t-lg transition-all duration-500 shadow-lg relative flex items-center justify-center"
                        style={{
                          height: heightPercent,
                          backgroundColor: ans.color,
                        }}
                      >
                        {isCorrectOption && (
                          <Check className="w-3.5 h-3.5 text-white bg-emerald-500 rounded-full border border-white absolute top-[-7px] flex items-center justify-center shrink-0" />
                        )}
                      </div>
                      <div
                        className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-black shrink-0"
                        style={{ backgroundColor: ans.color }}
                      >
                        {shapesMap[ans.shape] || '■'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null;
        })()}

        {/* Answer Breakdown comparison card */}
        <div className="w-full max-w-sm bg-black/25 border border-white/10 rounded-3xl p-5 space-y-4 text-left backdrop-blur-md my-4 animate-fade-in">
          <h3 className="text-xs uppercase font-extrabold tracking-wider text-white/50 border-b border-white/10 pb-2">
            Round Summary
          </h3>
          
          <div className="space-y-1">
            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest block">
              Your Choice
            </span>
            {selectedAnswerIds.length > 0 ? (
              <div className="flex flex-wrap gap-2 mt-1">
                {activeQuestion.answers
                  .filter((ans) => selectedAnswerIds.includes(ans.id))
                  .map((ans) => (
                    <div
                      key={ans.id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold text-white border border-white/10"
                      style={{ backgroundColor: ans.color }}
                    >
                      <span className="shrink-0">{shapesMap[ans.shape] || '■'}</span>
                      <span className="truncate max-w-[200px]">{ans.text}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-sm font-semibold text-rose-300 mt-0.5">
                <Clock className="w-3.5 h-3.5 inline-block mr-0.5" /> Time Out (No answer submitted)
              </p>
            )}
          </div>

          <div className="space-y-1 pt-1">
            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest block">
              Correct Answer
            </span>
            <div className="flex flex-wrap gap-2 mt-1">
              {activeQuestion.answers
                .filter((ans) => roundResult.correctAnswerIds.includes(ans.id))
                .map((ans) => (
                  <div
                    key={ans.id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold text-white border border-white/10"
                    style={{ backgroundColor: ans.color }}
                  >
                    <span className="shrink-0">{shapesMap[ans.shape] || '■'}</span>
                    <span className="truncate max-w-[200px]">{ans.text}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        <div className="w-full max-w-xs bg-black/20 border border-white/10 p-4 rounded-2xl mb-8">
          <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest block">
            Total Score
          </span>
          <span className="text-2xl font-black font-mono mt-0.5 block">
            {player.score.toLocaleString()}
          </span>
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER: LEADERBOARD WAIT STATE
  // ==========================================
  if (sessionStatus === 'leaderboard') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center text-slate-100 font-sans" style={customStyles}>
        <Award className="w-12 h-12 text-violet-500 animate-bounce mb-4" />
        <h1 className="text-2xl font-black">Scoreboard Time!</h1>
        <p className="text-slate-400 text-sm max-w-xs mt-2 leading-relaxed">
          Look at the main presenter screen to check the current standings and see if you made it to the top!
        </p>
        <div className="w-full max-w-xs bg-slate-900 border border-slate-800 p-4 rounded-2xl mt-8">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">
            Your Current Score
          </span>
          <span className="text-2xl font-black font-mono text-violet-400 mt-0.5 block">
            {player.score.toLocaleString()}
          </span>
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER: FINISHED STATE (GAME OVER RANK REVEAL)
  // ==========================================
  if (sessionStatus === 'finished') {
    const sortedPodium = [...podiumPlayers].sort((a, b) => b.score - a.score).slice(0, 3);
    const firstPlace = sortedPodium[0];
    const secondPlace = sortedPodium[1];
    const thirdPlace = sortedPodium[2];

    return (
      <div className="relative min-h-screen bg-slate-950 flex flex-col justify-between items-center p-6 text-center text-slate-100 font-sans overflow-hidden" style={customStyles}>
        {/* Glow */}
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-violet-900/10 blur-[150px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-rose-900/10 blur-[150px] pointer-events-none" />

        <div className="flex items-center justify-between gap-4 z-10 w-full max-w-md mt-2">
          <span className="text-[10px] font-black bg-amber-600 px-2.5 py-1.5 rounded-lg uppercase tracking-wider text-white">
            Final Standings
          </span>
          <div className="flex items-center gap-1.5">
            <Trophy className="w-4 h-4 text-amber-500 animate-bounce" />
            <span className="text-slate-400 font-bold text-xs">Game Over</span>
          </div>
        </div>

        <div className="my-2 text-center z-10">
          <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-fuchsia-500 to-rose-400 tracking-tight leading-none">
            QuizArena Podium
          </h1>
          <p className="text-slate-500 text-[10px] mt-1.5">
            Celebrating the game champions!
          </p>
        </div>

        {/* 3D Podium Layout */}
        <div className="flex-1 max-w-md mx-auto w-full flex items-end justify-center gap-2 sm:gap-4 z-10 py-6">
          {/* 2nd Place Block (Left) */}
          {secondPlace && (
            <div className="flex flex-col items-center gap-2 w-1/4 min-w-[70px] animate-scale-in">
              <div className="text-center w-full min-w-0">
                <span className="text-xl" title="Silver Medal">🥈</span>
                <h3 className="font-extrabold text-[11px] sm:text-xs text-white truncate w-full mt-0.5">
                  {secondPlace.nickname}
                </h3>
                <span className="font-mono text-[10px] text-violet-400 font-bold">
                  {secondPlace.score.toLocaleString()}
                </span>
              </div>
              <div className="bg-slate-900 border-x border-t border-slate-800 rounded-t-2xl w-full h-24 flex flex-col items-center justify-center shadow-xl">
                <span className="font-black text-2xl text-slate-500">2</span>
              </div>
            </div>
          )}

          {/* 1st Place Block (Center - Highest) */}
          {firstPlace && (
            <div className="flex flex-col items-center gap-2 w-1/3 min-w-[90px] z-10 animate-scale-in">
              <div className="text-center w-full min-w-0 flex flex-col items-center">
                <Trophy className="w-6 h-6 text-amber-400 fill-amber-400 animate-pulse" />
                <h3 className="font-black text-xs sm:text-sm text-white truncate w-full mt-0.5">
                  {firstPlace.nickname}
                </h3>
                <span className="font-mono text-xs text-fuchsia-400 font-bold">
                  {firstPlace.score.toLocaleString()}
                </span>
              </div>
              <div className="bg-slate-900/90 border-x border-t border-slate-700/60 rounded-t-2xl w-full h-32 flex flex-col items-center justify-center shadow-2xl relative">
                <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-500 rounded-t-full" />
                <span className="font-black text-3xl text-amber-500">1</span>
              </div>
            </div>
          )}

          {/* 3rd Place Block (Right) */}
          {thirdPlace && (
            <div className="flex flex-col items-center gap-2 w-1/4 min-w-[70px] animate-scale-in">
              <div className="text-center w-full min-w-0">
                <span className="text-xl" title="Bronze Medal">🥉</span>
                <h3 className="font-extrabold text-[11px] sm:text-xs text-white truncate w-full mt-0.5">
                  {thirdPlace.nickname}
                </h3>
                <span className="font-mono text-[10px] text-violet-400 font-bold">
                  {thirdPlace.score.toLocaleString()}
                </span>
              </div>
              <div className="bg-slate-900 border-x border-t border-slate-800 rounded-t-2xl w-full h-16 flex flex-col items-center justify-center shadow-xl">
                <span className="font-black text-2xl text-amber-700">3</span>
              </div>
            </div>
          )}
        </div>

        {/* Player Stats Block */}
        <div className="w-full max-w-xs bg-slate-900/60 border border-slate-850 p-4 rounded-2xl mb-4 z-10 space-y-3">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              Your Performance
            </span>
            <span className="text-xs font-black text-violet-400">
              #{finalRank ?? '-'} Rank
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">Final Points</span>
            <span className="text-lg font-black font-mono text-white">
              {player.score.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">Answer Streak</span>
            <span className="text-sm font-bold text-amber-400 flex items-center gap-0.5">
              <Flame className="w-4 h-4 fill-amber-400" /> {player.streak}
            </span>
          </div>
        </div>

        <Button
          onClick={() => {
            localStorage.removeItem(`quizarena_token_${sessionId}`);
            router.push('/play');
          }}
          className="bg-slate-900 hover:bg-slate-800 border border-slate-800 font-bold rounded-xl text-xs h-11 px-6 w-full max-w-xs mb-6 z-10"
        >
          Return to Arena Joiner
        </Button>
      </div>
    );
  }

  // ==========================================
  // RENDER: ACTIVE QUESTION INTERFACES (INPUT MODES)
  // ==========================================
  if ((sessionStatus === 'question_active' || sessionStatus === 'question_paused') && activeQuestion) {
    // 1. SUBMITTED VIEW
    if (submissionState === 'submitted') {
      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center text-slate-100 font-sans">
          <Loader2 className="w-10 h-10 text-violet-500 animate-spin mb-6" />
          <h1 className="text-2xl font-black text-white mb-6">Answer Locked In!</h1>
          {timeLeft > 0 && (
            <div className="flex justify-center mb-6">
              <div className={`relative w-24 h-24 rounded-full border-4 flex flex-col items-center justify-center bg-slate-950/80 shadow-lg backdrop-blur transition-all duration-300 ${
                timeLeft <= 5 
                  ? 'border-rose-500 shadow-rose-500/35 scale-110 animate-bounce' 
                  : 'border-violet-500 shadow-violet-500/20'
              }`}>
                <div className={`absolute inset-0 rounded-full border border-dashed animate-spin ${
                  timeLeft <= 5 ? 'border-rose-400/40' : 'border-violet-400/30'
                }`} style={{ animationDuration: timeLeft <= 5 ? '3s' : '10s' }} />
                
                <span className={`text-3xl font-black font-mono transition-colors duration-300 ${
                  timeLeft <= 5 ? 'text-rose-500 animate-pulse' : 'text-white'
                }`}>
                  {timeLeft}
                </span>
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                  Seconds
                </span>
              </div>
            </div>
          )}
          <p className="text-slate-400 text-sm max-w-xs">
            Waiting for other players to submit and for the host to reveal the results...
          </p>
        </div>
      );
    }

    // 2. SUBMITTING INTERMEDIATE VIEW
    if (submissionState === 'submitting') {
      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center text-slate-100 font-sans">
          <Loader2 className="w-10 h-10 text-violet-500 animate-spin mb-4" />
          <p className="text-sm font-semibold text-slate-400">Grading answer...</p>
        </div>
      );
    }

    // 3. INPUT FORM RENDER BASED ON QUESTION TYPE
    return (
      <div className="relative min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 font-sans" style={customStyles}>
        {sessionStatus === 'question_paused' && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 z-50 animate-fade-in">
            <Pause className="w-12 h-12 text-amber-500 animate-pulse mb-3" />
            <h2 className="text-xl font-bold text-white mb-1">Game is Paused</h2>
            <p className="text-slate-400 text-xs max-w-xs">
              The host has paused the round timer. Hold on, submissions will resume shortly!
            </p>
          </div>
        )}
        {/* Header summary */}
        <div className="flex items-center justify-between text-xs text-slate-500 font-semibold border-b border-slate-900 pb-3">
          <span>PIN: {sessionId}</span>
          <span className="uppercase tracking-widest text-violet-400 font-bold">
            {player.team_name ? <><Users className="w-3 h-3 inline-block mr-0.5" /> {player.team_name}</> : activeQuestion.type.replace('_', ' ')}
          </span>
          <span>Score: {player.score}</span>
        </div>

        {/* Input Interface Area */}
        <main className="flex-1 flex flex-col items-center justify-center py-6 w-full max-w-md mx-auto">
          {/* Question Prompt & Timer */}
          <div className="text-center space-y-4 mb-6 max-w-sm flex flex-col items-center">
            {activeMultiplier > 1 && (
              <div className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-black uppercase tracking-wider animate-pulse flex items-center gap-1 mb-1">
                <Zap className="w-3.5 h-3.5" /> {activeMultiplier}x Points Active
              </div>
            )}
            
            {timeLeft > 0 && (
              <div className="flex justify-center my-2">
                <div className={`relative w-24 h-24 rounded-full border-4 flex flex-col items-center justify-center bg-slate-950/80 shadow-lg backdrop-blur transition-all duration-300 ${
                  timeLeft <= 5 
                    ? 'border-rose-500 shadow-rose-500/35 scale-110 animate-bounce' 
                    : 'border-violet-500 shadow-violet-500/20'
                }`}>
                  <div className={`absolute inset-0 rounded-full border border-dashed animate-spin ${
                    timeLeft <= 5 ? 'border-rose-400/40' : 'border-violet-400/30'
                  }`} style={{ animationDuration: timeLeft <= 5 ? '3s' : '10s' }} />
                  
                  <span className={`text-3xl font-black font-mono transition-colors duration-300 ${
                    timeLeft <= 5 ? 'text-rose-500 animate-pulse' : 'text-white'
                  }`}>
                    {timeLeft}
                  </span>
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                    Seconds
                  </span>
                </div>
              </div>
            )}

            <h2 className="text-xl font-extrabold text-white leading-snug tracking-tight">
              {activeQuestion.prompt}
            </h2>
          </div>

          {activeQuestion.type === 'type_answer' ? (
            // TYPE ANSWER MODE
            <form onSubmit={handleTextSubmit} className="w-full space-y-4 bg-slate-900/60 p-6 border border-slate-800 rounded-3xl shadow-xl">
              <div className="text-center space-y-1 mb-4">
                <h2 className="text-xs uppercase font-extrabold text-slate-500 tracking-wider">
                  Type Your Answer
                </h2>
                <p className="text-slate-400 text-xs">
                  Fuzzy case-insensitive matching is active.
                </p>
              </div>

              <Input
                placeholder="Type here..."
                value={typeInputValue}
                onChange={(e) => setTypeInputValue(e.target.value)}
                className="bg-slate-950 border-slate-800 h-14 text-center text-lg font-bold focus-visible:ring-violet-500 rounded-xl"
                maxLength={40}
                required
              />

              <Button
                type="submit"
                className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold h-12 rounded-xl text-base shadow-lg"
              >
                Submit Answer
              </Button>
            </form>
          ) : activeQuestion.type === 'multi_select' ? (
            // MULTI-SELECT CHECKBOX GRID MODE
            <div className="w-full space-y-6">
              <div className="text-center space-y-1 mb-2">
                <h2 className="text-xs uppercase font-extrabold text-violet-400 tracking-wider">
                  Select Multiple Answers
                </h2>
                <p className="text-slate-500 text-xs">
                  Pick all options you believe are correct, then tap Submit.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 w-full">
                {activeQuestion.answers.map((ans) => {
                  const isChecked = selectedAnswerIds.includes(ans.id);

                  return (
                    <div
                      key={ans.id}
                      onClick={() => handleCheckboxToggle(ans.id)}
                      className={`relative p-5 rounded-2xl flex flex-col items-center justify-center gap-2.5 cursor-pointer shadow-lg select-none transition-all border border-black/10 text-white font-bold h-40 ${
                        isChecked ? 'ring-4 ring-white/60 scale-95 shadow-2xl' : ''
                      }`}
                      style={{ backgroundColor: ans.color }}
                    >
                      <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-2xl font-black shrink-0">
                        {shapesMap[ans.shape] || '■'}
                      </div>
                      
                      <span className="text-xs sm:text-sm text-center font-extrabold line-clamp-2 max-w-full px-1 leading-snug">
                        {ans.text}
                      </span>
                      
                      <div className="absolute top-3 right-3 bg-white/20 rounded border border-white/10 w-5 h-5 flex items-center justify-center">
                        <Checkbox checked={isChecked} onCheckedChange={() => {}} className="border-0 bg-transparent text-white" />
                      </div>
                    </div>
                  );
                })}
              </div>

              <Button
                onClick={handleMultiSubmit}
                className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold h-12 rounded-xl text-base shadow-lg"
              >
                Submit Choices
              </Button>
            </div>
          ) : (
            // MCQ / TRUE-FALSE / POLL SINGLE CLICK BUTTONS GRID
            <div className="grid grid-cols-2 gap-4 w-full">
              {activeQuestion.answers.map((ans) => (
                <button
                  key={ans.id}
                  type="button"
                  onClick={() => handleChoiceTap(ans.id)}
                  className="p-5 rounded-2xl flex flex-col items-center justify-center gap-2.5 cursor-pointer shadow-lg text-white font-bold transition-all border border-black/10 active:scale-95 duration-100 h-40 text-center hover:brightness-105"
                  style={{ backgroundColor: ans.color }}
                >
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-2xl font-black shrink-0">
                    {shapesMap[ans.shape] || '■'}
                  </div>
                  <span className="text-xs sm:text-sm text-center font-extrabold line-clamp-2 max-w-full px-1 leading-snug">
                    {ans.text}
                  </span>
                </button>
              ))}
            </div>
          )}
        </main>

        {/* Footer timing indicator */}
        <div className="flex justify-center items-center gap-1.5 py-4 border-t border-slate-900 text-slate-500 text-xs font-semibold text-center">
          <Clock className="w-4 h-4 text-slate-500" />
          <span>Timer is ticking! Answer quickly for a speed bonus.</span>
        </div>
      </div>
    );
  }

  // Fallback Loading screen
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100 font-sans">
      <Loader2 className="w-10 h-10 text-violet-500 animate-spin mb-4" />
      <p className="text-sm font-semibold text-slate-400">Loading arena state...</p>
    </div>
  );
}
