'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  kickPlayer,
  revealQuestionResults,
  goToLeaderboard,
  goToNextQuestion,
  goToPodium,
  endGameSession,
} from '@/app/actions/game';
import { Flame, Users, Play, Pause, UserX, AlertCircle, Trophy, ArrowRight, Home, CheckCircle2, Clock, Settings, Edit3, Zap, SkipForward, Send, Activity, ChevronDown, ChevronUp, MessageSquare, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import QRCode from 'qrcode';
import { playJoinSound, playTickSound, playRevealSound, playFanfareSound } from '@/lib/sounds';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface Player {
  id: string;
  session_id: string;
  nickname: string;
  score: number;
  streak: number;
  joined_at: string;
  connected: boolean;
}

interface LeaderboardPlayer {
  id: string;
  nickname: string;
  score: number;
  streak: number;
  connected: boolean;
}

interface AnswerOption {
  id: string;
  text: string;
  color: string;
  shape: string;
  is_correct?: boolean;
}

interface Question {
  id: string;
  type: string;
  prompt: string;
  media_url: string | null;
  media_type: string | null;
  time_limit_seconds: number;
  points_base: number;
  scoring_type: string;
  answers: AnswerOption[];
}

interface HostGameClientProps {
  initialSession: {
    id: string;
    pin: string;
    status: string;
    current_question_index: number;
    question_started_at: string | null;
    quiz_id: string;
  };
  quiz: {
    id: string;
    title: string;
    description: string;
    theme: Record<string, unknown>;
  };
  questions: Question[];
  initialPlayers: Player[];
}

export default function HostGameClient({
  initialSession,
  quiz,
  questions,
  initialPlayers,
}: HostGameClientProps) {
  const router = useRouter();
  const supabase = createClient();

  // Core game states
  const [session, setSession] = useState(initialSession);
  const [players, setPlayers] = useState<Player[]>(initialPlayers);
  const [kickingId, setKickingId] = useState<string | null>(null);
  const [isManagePlayersOpen, setIsManagePlayersOpen] = useState(false);

  // Active question loop variables
  const [timeLeft, setTimeLeft] = useState<number>(20);
  const [submissionsCount, setSubmissionsCount] = useState<number>(0);
  const [revealData, setRevealData] = useState<{
    optionCounts: Record<string, number>;
    leaderboard: LeaderboardPlayer[];
  } | null>(null);

  // Live Question Editor state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [editAnswers, setEditAnswers] = useState<{ id: string; text: string }[]>([]);

  // Multiplier state
  const [isMultiplierActive, setIsMultiplierActive] = useState(false);

  // Host Announcement state
  const [announcementText, setAnnouncementText] = useState('');
  const [isAnnouncementOpen, setIsAnnouncementOpen] = useState(false);

  // Activity Feed state
  const [activityFeed, setActivityFeed] = useState<{ id: string; type: string; message: string; time: Date }[]>([]);
  const [isActivityOpen, setIsActivityOpen] = useState(false);

  // Question Jumper state
  const [isJumperOpen, setIsJumperOpen] = useState(false);

  // QR Code State
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    if (session.status === 'lobby' && session.pin) {
      const joinUrl = `${window.location.origin}/play?pin=${session.pin}`;
      QRCode.toDataURL(
        joinUrl,
        {
          width: 256,
          margin: 2,
          color: {
            dark: '#0f172a', // dark blue QR Code elements
            light: '#ffffff', // white QR Code background
          },
        },
        (err, url) => {
          if (!err && url) {
            setQrDataUrl(url);
          } else if (err) {
            console.error('Failed to generate QR Code:', err);
          }
        }
      );
    }
  }, [session.status, session.pin]);

  const activeQuestionIndex = session.current_question_index;
  const activeQuestion = (questions && questions.length > 0)
    ? (questions[activeQuestionIndex] || questions[0])
    : null;
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Define shape map
  const shapesMap: Record<string, string> = {
    triangle: '▲',
    diamond: '◆',
    circle: '●',
    square: '■',
    star: '★',
    hexagon: '⬢',
  };

  // Activity Feed helper (must be defined before useEffects that reference it)
  const addActivityEntry = useCallback((type: string, message: string) => {
    setActivityFeed((prev) => [
      { id: crypto.randomUUID(), type, message, time: new Date() },
      ...prev,
    ].slice(0, 50)); // keep last 50 entries
  }, []);

  // Reveal Question results (grades, computes scoreboard, triggers reveal status)
  const handleRevealAnswer = React.useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!activeQuestion) return;

    playRevealSound();
    const loadingToast = toast.loading('Calculating scores...');
    try {
      // Call server action to apply scores & get statistics
      const results = await revealQuestionResults(session.id, activeQuestion.id);
      setRevealData(results);

      // Broadcast results reveal to players
      const broadcastChannel = supabase.channel(`session_channel_${session.id}`);
      const correctOptionIds = activeQuestion.answers
        .filter((ans) => ans.is_correct)
        .map((ans) => ans.id);

      broadcastChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          broadcastChannel.send({
            type: 'broadcast',
            event: 'question:reveal',
            payload: {
              correct_answer_ids: correctOptionIds,
              leaderboard: results.leaderboard,
              option_counts: results.optionCounts,
            },
          });
          supabase.removeChannel(broadcastChannel);
        }
      });

      toast.success('Results calculated!', { id: loadingToast });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reveal results.', { id: loadingToast });
    }
  }, [session.id, activeQuestion, supabase]);

  // 1. Setup Realtime Player database synchronizer
  useEffect(() => {
    const channel = supabase
      .channel(`host_players_${session.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'players',
          filter: `session_id=eq.${session.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setPlayers((prev) => {
              if (prev.find((p) => p.id === payload.new.id)) return prev;
              playJoinSound();
              addActivityEntry('join', `${(payload.new as Player).nickname} joined the lobby`);
              return [...prev, payload.new as Player];
            });
          } else if (payload.eventType === 'DELETE') {
            const removed = players.find((p) => p.id === payload.old.id);
            if (removed) addActivityEntry('kick', `${removed.nickname} was removed`);
            setPlayers((prev) => prev.filter((p) => p.id !== payload.old.id));
          } else if (payload.eventType === 'UPDATE') {
            setPlayers((prev) =>
              prev.map((p) => (p.id === payload.new.id ? (payload.new as Player) : p))
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, session.id, addActivityEntry, players]);

  // 2. Setup Realtime Session database updates synchronizer
  useEffect(() => {
    const channel = supabase
      .channel(`host_session_${session.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'game_sessions',
          filter: `id=eq.${session.id}`,
        },
        (payload) => {
          const updatedSession = payload.new as typeof session;
          setSession(updatedSession);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, session.id]);

  // 3. Listen to Submissions count dynamically during question_active
  useEffect(() => {
    if (session.status !== 'question_active') {
      setSubmissionsCount(0);
      return;
    }

    // Load current submissions for this round initially
    const loadInitialSubmissions = async () => {
      if (!activeQuestion) return;
      const { count } = await supabase
        .from('answers_submitted')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', session.id)
        .eq('question_id', activeQuestion.id);
      setSubmissionsCount(count || 0);
    };
    loadInitialSubmissions();

    // Listen to new submissions in realtime
    const channel = supabase
      .channel(`host_submissions_${session.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'answers_submitted',
          filter: `session_id=eq.${session.id}`,
        },
        (payload) => {
          if (activeQuestion && payload.new.question_id === activeQuestion.id) {
            setSubmissionsCount((prev) => prev + 1);
            // Find player nickname for activity feed
            const answerer = players.find((p) => p.id === payload.new.player_id);
            if (answerer) addActivityEntry('answer', `${answerer.nickname} submitted an answer`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, session.id, session.status, activeQuestion, addActivityEntry, players]);

  // 4. Timer Tick-down thread logic
  useEffect(() => {
    if (session.status !== 'question_active' || !session.question_started_at || !activeQuestion) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const startTimer = () => {
      if (timerRef.current) clearInterval(timerRef.current);

      const timeLimit = activeQuestion.time_limit_seconds;
      const startedAt = new Date(session.question_started_at!).getTime();

      const updateTimer = () => {
        const elapsed = (Date.now() - startedAt) / 1000;
        const remaining = Math.max(0, Math.ceil(timeLimit - elapsed));
        setTimeLeft(remaining);

        if (remaining <= 5 && remaining > 0) {
          playTickSound();
        }

        if (remaining <= 0) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleRevealAnswer();
        }
      };

      updateTimer(); // run once immediately
      timerRef.current = setInterval(updateTimer, 1000);
    };

    startTimer();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [session.status, session.question_started_at, activeQuestion, handleRevealAnswer]);

  // 5. Confetti trigger for podium finish
  useEffect(() => {
    if (session.status === 'finished') {
      playFanfareSound();
      // Fire confetti bursts!
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
  }, [session.status]);

  // Kick Player Handler
  const handleKickPlayer = async (playerId: string, nickname: string) => {
    if (kickingId) return;
    setKickingId(playerId);
    try {
      await kickPlayer(playerId, session.id);
      toast.success(`Kicked player "${nickname}" from the lobby.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to kick player.');
    } finally {
      setKickingId(null);
    }
  };

  // Toggle Pause/Resume
  const handleTogglePause = async () => {
    const isPaused = session.status === 'question_paused';
    try {
      if (isPaused) {
        // Resume from epoch-based paused time
        const startedAt = new Date(session.question_started_at!).getTime();
        const elapsed = startedAt; // in paused state, question_started_at stores the elapsed duration
        const newStartedAt = new Date(Date.now() - elapsed).toISOString();

        const { error } = await supabase
          .from('game_sessions')
          .update({
            status: 'question_active',
            question_started_at: newStartedAt,
          })
          .eq('id', session.id);

        if (error) throw error;
        toast.success('Game resumed!');
      } else {
        // Pause and store elapsed time in question_started_at epoch
        const startedAt = new Date(session.question_started_at!).getTime();
        const elapsed = Date.now() - startedAt;
        const pausedStartedAt = new Date(elapsed).toISOString();

        const { error } = await supabase
          .from('game_sessions')
          .update({
            status: 'question_paused',
            question_started_at: pausedStartedAt,
          })
          .eq('id', session.id);

        if (error) throw error;
        toast.success('Game paused!');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to toggle pause.');
    }
  };

  // Add +10 seconds to the clock
  const handleAddTime = async () => {
    if (!session.question_started_at) return;
    try {
      const isPaused = session.status === 'question_paused';
      let newStartedAt;

      if (isPaused) {
        const elapsed = new Date(session.question_started_at).getTime();
        const newElapsed = Math.max(0, elapsed - 10000); // reduce elapsed time by 10s
        newStartedAt = new Date(newElapsed).toISOString();
      } else {
        const startedAt = new Date(session.question_started_at).getTime();
        newStartedAt = new Date(startedAt + 10000).toISOString(); // push start time 10s into the future
      }

      const { error } = await supabase
        .from('game_sessions')
        .update({
          question_started_at: newStartedAt,
        })
        .eq('id', session.id);

      if (error) throw error;
      
      setTimeLeft((prev) => prev + 10);
      toast.success('Added 10 seconds to the clock!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add time.');
    }
  };

  // Start Game
  const handleStartGame = async () => {
    if (!questions || questions.length === 0) {
      toast.error('You cannot start a game with 0 questions.');
      return;
    }
    if (players.length === 0) {
      toast.error('You cannot start a game with 0 players.');
      return;
    }

    try {
      const serverStartedAt = new Date().toISOString();

      const { error } = await supabase
        .from('game_sessions')
        .update({
          status: 'question_active',
          current_question_index: 0,
          question_started_at: serverStartedAt,
        })
        .eq('id', session.id);

      if (error) throw error;

      // Broadcast event
      const broadcastChannel = supabase.channel(`session_channel_${session.id}`);
      const firstQ = questions[0];
      const cleanedAnswers = firstQ.answers.map((ans) => ({
        id: ans.id,
        text: ans.text,
        color: ans.color,
        shape: ans.shape,
      }));

      broadcastChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          broadcastChannel.send({
            type: 'broadcast',
            event: 'question:start',
            payload: {
              question_index: 0,
              type: firstQ.type,
              prompt: firstQ.prompt,
              media_url: firstQ.media_url,
              media_type: firstQ.media_type,
              time_limit_seconds: firstQ.time_limit_seconds,
              answers: cleanedAnswers,
              server_started_at: serverStartedAt,
            },
          });
          supabase.removeChannel(broadcastChannel);
        }
      });

      toast.success('Game started! Broadcasting first question.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start game.');
    }
  };



  // Move to Leaderboard View
  const handleShowLeaderboard = async () => {
    try {
      await goToLeaderboard(session.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to show leaderboard.');
    }
  };

  // Progress to Next Question
  const handleNextQuestion = async () => {
    try {
      const nextIndex = activeQuestionIndex + 1;
      const nextQ = questions[nextIndex];
      const serverStartedAt = new Date().toISOString();

      await goToNextQuestion(session.id, nextIndex);
      setRevealData(null);

      // Broadcast next question to players
      const broadcastChannel = supabase.channel(`session_channel_${session.id}`);
      const cleanedAnswers = nextQ.answers.map((ans) => ({
        id: ans.id,
        text: ans.text,
        color: ans.color,
        shape: ans.shape,
      }));

      broadcastChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          broadcastChannel.send({
            type: 'broadcast',
            event: 'question:start',
            payload: {
              question_index: nextIndex,
              type: nextQ.type,
              prompt: nextQ.prompt,
              media_url: nextQ.media_url,
              media_type: nextQ.media_type,
              time_limit_seconds: nextQ.time_limit_seconds,
              answers: cleanedAnswers,
              server_started_at: serverStartedAt,
            },
          });
          supabase.removeChannel(broadcastChannel);
        }
      });

      toast.success('Loading next question.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load next question.');
    }
  };

  // Show final podium screen
  const handleShowPodium = async () => {
    try {
      await goToPodium(session.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to show podium.');
    }
  };

  // Return to Dashboard and terminate game room
  const handleCloseSession = async () => {
    try {
      await endGameSession(session.id);
      router.push('/dashboard');
      router.refresh();
    } catch {
      router.push('/dashboard');
    }
  };

  // ==========================================
  // NEW FEATURE HANDLERS
  // ==========================================


  // Live Question Editor: Open modal with current question data
  const handleOpenEditor = () => {
    if (!activeQuestion) return;
    setEditPrompt(activeQuestion.prompt);
    setEditAnswers(activeQuestion.answers.map((ans) => ({ id: ans.id, text: ans.text })));
    setIsEditorOpen(true);
  };

  // Live Question Editor: Save changes to DB and broadcast update
  const handleSaveQuestionEdit = async () => {
    if (!activeQuestion) return;
    try {
      // Update question in database
      const updatedAnswers = activeQuestion.answers.map((ans) => {
        const edited = editAnswers.find((ea) => ea.id === ans.id);
        return edited ? { ...ans, text: edited.text } : ans;
      });

      const { error } = await supabase
        .from('questions')
        .update({
          prompt: editPrompt,
          answers: updatedAnswers,
        })
        .eq('id', activeQuestion.id);

      if (error) throw error;

      // Update local question data
      activeQuestion.prompt = editPrompt;
      activeQuestion.answers = updatedAnswers;

      // Broadcast update to players
      const broadcastChannel = supabase.channel(`session_channel_${session.id}`);
      const cleanedAnswers = updatedAnswers.map((ans) => ({
        id: ans.id,
        text: ans.text,
        color: ans.color,
        shape: ans.shape,
      }));

      broadcastChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          broadcastChannel.send({
            type: 'broadcast',
            event: 'question:update',
            payload: {
              prompt: editPrompt,
              answers: cleanedAnswers,
            },
          });
          supabase.removeChannel(broadcastChannel);
        }
      });

      setIsEditorOpen(false);
      addActivityEntry('edit', 'Host edited the current question live');
      toast.success('Question updated and broadcasted to players!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save question edits.');
    }
  };

  // Multiplier Toggle: Broadcast multiplier status to players
  const handleToggleMultiplier = () => {
    const newState = !isMultiplierActive;
    setIsMultiplierActive(newState);

    const broadcastChannel = supabase.channel(`session_channel_${session.id}`);
    broadcastChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        broadcastChannel.send({
          type: 'broadcast',
          event: 'multiplier:change',
          payload: { multiplier: newState ? 2 : 1 },
        });
        supabase.removeChannel(broadcastChannel);
      }
    });

    addActivityEntry('multiplier', newState ? 'Double points activated!' : 'Double points deactivated');
    toast.success(newState ? 'Double Points Activated! (2x)' : 'Multiplier Deactivated (1x)');
  };

  // Question Jumper: Jump to any question index
  const handleJumpToQuestion = async (targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= questions.length || targetIndex === activeQuestionIndex) return;
    try {
      const targetQ = questions[targetIndex];
      const serverStartedAt = new Date().toISOString();

      await goToNextQuestion(session.id, targetIndex);
      setRevealData(null);
      setIsMultiplierActive(false);
      setIsJumperOpen(false);

      // Broadcast the jumped question to players
      const broadcastChannel = supabase.channel(`session_channel_${session.id}`);
      const cleanedAnswers = targetQ.answers.map((ans) => ({
        id: ans.id,
        text: ans.text,
        color: ans.color,
        shape: ans.shape,
      }));

      broadcastChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          broadcastChannel.send({
            type: 'broadcast',
            event: 'question:start',
            payload: {
              question_index: targetIndex,
              type: targetQ.type,
              prompt: targetQ.prompt,
              media_url: targetQ.media_url,
              media_type: targetQ.media_type,
              time_limit_seconds: targetQ.time_limit_seconds,
              answers: cleanedAnswers,
              server_started_at: serverStartedAt,
            },
          });
          supabase.removeChannel(broadcastChannel);
        }
      });

      addActivityEntry('jump', `Host jumped to Question ${targetIndex + 1}`);
      toast.success(`Jumped to Question ${targetIndex + 1}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to jump to question.');
    }
  };

  // Host Announcement: Send a text message to all players
  const handleSendAnnouncement = () => {
    if (!announcementText.trim()) {
      toast.error('Please enter a message to broadcast.');
      return;
    }

    const broadcastChannel = supabase.channel(`session_channel_${session.id}`);
    broadcastChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        broadcastChannel.send({
          type: 'broadcast',
          event: 'host:announcement',
          payload: { message: announcementText.trim() },
        });
        supabase.removeChannel(broadcastChannel);
      }
    });

    addActivityEntry('announcement', `Host broadcast: "${announcementText.trim()}"`);
    toast.success('Announcement sent to all players!');
    setAnnouncementText('');
    setIsAnnouncementOpen(false);
  };

  const connectedCount = players.filter((p) => p.connected).length;
  const isLastQuestion = activeQuestionIndex === questions.length - 1;

  // BACKGROUND THEME STYLE EXTRACTOR
  const customStyles = {
    backgroundColor: (quiz.theme?.bgColor as string) || '#0a0f1d',
    color: (quiz.theme?.textColor as string) || '#f1f5f9',
  };

  // ==========================================
  // RENDER: LOBBY STATE
  // ==========================================
  if (session.status === 'lobby') {
    return (
      <div
        className="relative min-h-screen w-full flex flex-col justify-between overflow-hidden font-sans"
        style={customStyles}
      >
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-violet-950/10 blur-[150px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-rose-950/10 blur-[150px] pointer-events-none" />

        <header className="p-6 bg-black/10 border-b border-slate-900/40 backdrop-blur z-10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-gradient-to-tr from-violet-600 to-fuchsia-600 p-2.5 rounded-xl flex items-center justify-center">
              <Flame className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-extrabold text-white text-lg tracking-tight leading-none">
                QuizArena Live Lobby
              </h1>
              <p className="text-slate-500 text-xs mt-0.5 max-w-[200px] sm:max-w-xs truncate">
                Quiz: {quiz.title}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-slate-800 bg-slate-950/80 text-xs font-semibold text-slate-400">
              <Users className="w-3.5 h-3.5" />
              <span>
                Connected: <strong className="text-white">{connectedCount}</strong> / {players.length}
              </span>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-6 py-12 grid lg:grid-cols-12 gap-8 items-center flex-1 z-10">
          <div className="lg:col-span-5 flex flex-col gap-6 text-center lg:text-left justify-center">
            <div className="space-y-2">
              <span className="text-xs uppercase tracking-widest text-violet-400 font-bold">
                Join instructions
              </span>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white leading-tight">
                Ready to Join? <br />
                <span className="bg-gradient-to-r from-violet-400 via-fuchsia-500 to-rose-400 bg-clip-text text-transparent">
                  Go to QuizArena.
                </span>
              </h2>
              <p className="text-slate-400 text-sm max-w-sm mx-auto lg:mx-0">
                Open your mobile browser, select Join Player, and input the room code below.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-center justify-center lg:justify-start max-w-sm mx-auto lg:mx-0 w-full">
              <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-6 shadow-2xl backdrop-blur text-center flex-1 w-full">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                  Room PIN Code
                </span>
                <div className="text-4xl sm:text-5xl font-black tracking-widest text-white mt-1 select-all bg-slate-950 border border-slate-900/60 py-3 rounded-2xl shadow-inner animate-pulse">
                  {session.pin.slice(0, 3)} {session.pin.slice(3)}
                </div>
              </div>

              {qrDataUrl && (
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-4 shadow-2xl backdrop-blur text-center flex flex-col items-center justify-center shrink-0 w-36 h-36 border-dashed border-2 border-violet-500/30">
                  <img src={qrDataUrl} alt="Lobby QR Code" className="w-24 h-24 bg-white p-1 rounded-xl shadow-md" />
                  <span className="text-[9px] uppercase font-black text-slate-400 tracking-wider mt-1.5 animate-pulse">
                    Scan to Join
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-7 flex flex-col gap-4 self-stretch justify-start min-h-[45vh] bg-slate-900/20 border border-slate-900/80 rounded-3xl p-6 backdrop-blur">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <span className="text-xs uppercase tracking-widest text-slate-400 font-bold flex items-center gap-1.5">
                <Users className="w-4 h-4 text-violet-500" /> Joined Players ({players.length})
              </span>
            </div>

            {(!questions || questions.length === 0) && (
              <div className="bg-rose-950/40 border border-rose-900/60 rounded-2xl p-4 text-rose-300 text-xs font-semibold flex items-center gap-3 mb-2 animate-fade-in">
                <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 animate-pulse" />
                <div>
                  <p className="font-bold">This quiz has 0 questions!</p>
                  <p className="text-rose-400 mt-0.5">Please open the quiz editor, add questions, and then host the lobby.</p>
                </div>
              </div>
            )}

            {players.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 p-8">
                <div className="p-3.5 bg-slate-950 border border-slate-900 rounded-2xl mb-3">
                  <AlertCircle className="w-8 h-8 text-slate-600 animate-bounce" />
                </div>
                <p className="font-semibold text-sm">Waiting for players to join...</p>
                <p className="text-xs text-slate-600 max-w-xs mt-1">
                  Once players join with their phone and enter the PIN, their nicknames will show up here.
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto max-h-[50vh] pr-1">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 animate-fade-in">
                  {players.map((p) => (
                    <div
                      key={p.id}
                      className={`relative p-3 rounded-xl border flex items-center justify-between gap-2 group transition-all duration-300 ${
                        p.connected
                          ? 'bg-slate-900/80 border-slate-800 text-slate-200 shadow-md'
                          : 'bg-slate-950/40 border-slate-950 text-slate-600'
                      }`}
                    >
                      <span className="font-bold text-sm truncate select-none">
                        {p.nickname}
                      </span>
                      <button
                        type="button"
                        disabled={!!kickingId}
                        onClick={() => handleKickPlayer(p.id, p.nickname)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-rose-500 shrink-0"
                        title="Kick Player"
                      >
                        <UserX className="w-3.5 h-3.5" />
                      </button>

                      {!p.connected && (
                        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-rose-500" title="Offline" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>

        <footer className="p-6 bg-black/10 border-t border-slate-900/40 backdrop-blur z-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-slate-500 text-xs text-center sm:text-left">
            Lobby PIN: <strong className="text-slate-300">{session.pin}</strong> | Keep this visible to players.
          </div>
          <Button
            onClick={handleStartGame}
            disabled={players.length === 0 || !questions || questions.length === 0}
            className="w-full sm:w-auto bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold h-12 px-8 rounded-xl text-base shadow-lg shadow-violet-500/20 flex items-center justify-center gap-2"
          >
            <Play className="w-5 h-5 fill-current" /> Start Game
          </Button>
        </footer>
      </div>
    );
  }



  // ==========================================
  // RENDER: ACTIVE QUESTION STATE (TIMER COUNTDOWN)
  // ==========================================
  if (session.status === 'question_active' || session.status === 'question_paused') {
    if (!activeQuestion) return null;
    return (
      <div
        className="relative min-h-screen w-full flex flex-col justify-between overflow-hidden font-sans p-6"
        style={customStyles}
      >
        {/* Title bar / Index + Question Jumper */}
        <div className="flex items-center justify-between gap-4 z-10">
          <div className="flex items-center gap-2">
            <span className="text-sm font-black bg-violet-600 px-3 py-1.5 rounded-xl uppercase tracking-wider text-white">
              Question {activeQuestionIndex + 1} of {questions.length}
            </span>

            {/* Question Jumper Dropdown */}
            <div className="relative">
              <Button
                variant="outline"
                onClick={() => setIsJumperOpen(!isJumperOpen)}
                className="border-slate-800 hover:bg-slate-900 text-slate-300 gap-1 h-8 rounded-lg text-[10px] px-2.5"
              >
                <SkipForward className="w-3.5 h-3.5 text-violet-400" />
                Jump
                {isJumperOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>
              {isJumperOpen && (
                <div className="absolute top-full left-0 mt-1 w-48 max-h-60 overflow-y-auto bg-slate-950 border border-slate-800 rounded-xl shadow-2xl z-50 p-1.5 animate-fade-in">
                  {questions.map((q, idx) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => handleJumpToQuestion(idx)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                        idx === activeQuestionIndex
                          ? 'bg-violet-600 text-white cursor-default'
                          : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                      }`}
                    >
                      <span className="font-black">Q{idx + 1}</span>{' '}
                      <span className="text-slate-400 truncate">{q.prompt.slice(0, 30)}{q.prompt.length > 30 ? '...' : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Multiplier Badge */}
            {isMultiplierActive && (
              <span className="px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 text-[10px] font-black uppercase tracking-wider animate-pulse flex items-center gap-1">
                <Zap className="w-3 h-3" /> 2x Points
              </span>
            )}
          </div>
          <span className="text-slate-400 font-semibold text-xs">
            QuizArena Live Game
          </span>
        </div>

        {/* Prompt Question */}
        <div className="my-6 text-center max-w-4xl mx-auto z-10">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-tight text-white">
            {activeQuestion.prompt}
          </h1>
        </div>

        {/* Active Question Workspace (Timer / Submissions count / Media) */}
        <div className="grid md:grid-cols-12 gap-8 items-center justify-center flex-1 max-w-5xl mx-auto w-full z-10">
          {/* Left: Timer */}
          <div className="md:col-span-3 flex flex-col items-center justify-center text-center order-2 md:order-1">
            <div className={`w-32 h-32 rounded-full border-8 ${session.status === 'question_paused' ? 'border-amber-500/40 animate-pulse' : 'border-violet-500/20'} flex flex-col items-center justify-center bg-slate-950/60 shadow-2xl relative`}>
              <span className={`text-4xl font-black ${timeLeft <= 5 && session.status !== 'question_paused' ? 'text-rose-500 animate-ping' : 'text-white'}`}>
                {timeLeft}
              </span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                {session.status === 'question_paused' ? 'Paused' : 'Seconds'}
              </span>
            </div>
          </div>

          {/* Center: Image / Video Media */}
          <div className="md:col-span-6 flex justify-center items-center h-64 sm:h-80 w-full order-1 md:order-2">
            {activeQuestion.media_url ? (
              activeQuestion.media_type === 'video' ? (
                <video
                  src={activeQuestion.media_url}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="max-h-full max-w-full rounded-2xl shadow-2xl object-contain border border-slate-800"
                />
              ) : (
                <img
                  // eslint-disable-next-line @next/next/no-img-element
                  src={activeQuestion.media_url}
                  alt="Question Media"
                  className="max-h-full max-w-full rounded-2xl shadow-2xl object-contain border border-slate-800"
                />
              )
            ) : (
              // Decorative animated icon placeholder if no media
              <div className="p-8 bg-slate-900/60 border border-slate-800 rounded-3xl w-full h-full flex flex-col items-center justify-center text-center">
                <Flame className="w-16 h-16 text-violet-500/40 animate-pulse mb-3" />
                <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                  QuizArena Showdown
                </span>
              </div>
            )}
          </div>

          {/* Right: Submissions counter */}
          <div className="md:col-span-3 flex flex-col items-center justify-center text-center order-3">
            <div className="w-32 h-32 rounded-full border-8 border-emerald-500/20 flex flex-col items-center justify-center bg-slate-950/60 shadow-2xl">
              <span className="text-4xl font-black text-emerald-400">
                {submissionsCount}
              </span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                Answers
              </span>
            </div>
            <span className="text-xs text-slate-400 mt-2 font-medium">
              out of {players.length} players
            </span>
          </div>
        </div>

        {/* Answers Grid layout */}
        <div className="grid sm:grid-cols-2 gap-4 max-w-5xl w-full mx-auto mt-6 z-10">
          {activeQuestion.answers.map((ans) => (
            <div
              key={ans.id}
              className="flex items-center gap-3.5 border border-slate-900/30 p-4 rounded-2xl select-none shadow-lg text-white font-bold transition-all text-lg"
              style={{ backgroundColor: ans.color }}
            >
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl font-black">
                {shapesMap[ans.shape] || '■'}
              </div>
              <span className="truncate">{ans.text}</span>
            </div>
          ))}
        </div>

        {/* Host controls footer */}
        <div className="flex items-center justify-between border-t border-slate-900/40 pt-4 mt-6 z-10 flex-wrap gap-2">
          <span className="text-slate-500 text-xs font-semibold">
            PIN: {session.pin} | Live submissions tracking
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Manage Players Dialog */}
            <Dialog open={isManagePlayersOpen} onOpenChange={setIsManagePlayersOpen}>
              <DialogTrigger
                render={
                  <Button variant="outline" className="border-slate-800 hover:bg-slate-900 text-slate-300 gap-1.5 h-10 rounded-xl text-xs">
                    <Settings className="w-4 h-4 text-violet-400" /> Players ({players.length})
                  </Button>
                }
              />
              <DialogContent className="bg-slate-950 border-slate-900 text-white max-w-md rounded-2xl shadow-2xl">
                <DialogHeader>
                  <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
                    <Users className="w-5 h-5 text-violet-500" /> Manage Session Players
                  </DialogTitle>
                  <DialogDescription className="text-slate-500 text-xs">
                    Kick players who are idle, names are inappropriate, or who have disconnected.
                  </DialogDescription>
                </DialogHeader>
                <div className="max-h-[50vh] overflow-y-auto space-y-2 mt-4 pr-1">
                  {players.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-4">No players joined yet.</p>
                  ) : (
                    players.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-2 h-2 rounded-full ${p.connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                          <span className="font-bold text-sm truncate max-w-[180px]">{p.nickname}</span>
                          <span className="text-[10px] text-slate-500">({p.score} pts)</span>
                        </div>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={!!kickingId}
                          onClick={() => handleKickPlayer(p.id, p.nickname)}
                          className="h-8 rounded-lg text-xs bg-rose-600 hover:bg-rose-500 text-white px-3 flex items-center gap-1 font-bold"
                        >
                          <UserX className="w-3.5 h-3.5" /> Kick
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </DialogContent>
            </Dialog>

            {/* Live Question Editor */}
            <Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
              <DialogTrigger
                render={
                  <Button variant="outline" onClick={handleOpenEditor} className="border-slate-800 hover:bg-slate-900 text-slate-300 gap-1.5 h-10 rounded-xl text-xs">
                    <Edit3 className="w-4 h-4 text-fuchsia-400" /> Edit
                  </Button>
                }
              />
              <DialogContent className="bg-slate-950 border-slate-900 text-white max-w-lg rounded-2xl shadow-2xl">
                <DialogHeader>
                  <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
                    <Edit3 className="w-5 h-5 text-fuchsia-500" /> Live Question Editor
                  </DialogTitle>
                  <DialogDescription className="text-slate-500 text-xs">
                    Edit the current question prompt and answers live. Changes broadcast instantly to all players.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <div className="space-y-1.5">
                    <label className="text-slate-400 font-extrabold text-[10px] uppercase tracking-wider">Question Prompt</label>
                    <Textarea
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      className="bg-slate-900 border-slate-800 text-white rounded-xl min-h-[80px] focus-visible:ring-fuchsia-500"
                      placeholder="Enter the question..."
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-slate-400 font-extrabold text-[10px] uppercase tracking-wider">Answer Options</label>
                    {editAnswers.map((ans, idx) => (
                      <div key={ans.id} className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-slate-500 w-5">{idx + 1}.</span>
                        <Input
                          value={ans.text}
                          onChange={(e) => {
                            const updated = [...editAnswers];
                            updated[idx] = { ...updated[idx], text: e.target.value };
                            setEditAnswers(updated);
                          }}
                          className="bg-slate-900 border-slate-800 text-white rounded-lg h-9 text-sm focus-visible:ring-fuchsia-500"
                        />
                      </div>
                    ))}
                  </div>
                  <Button
                    onClick={handleSaveQuestionEdit}
                    className="w-full bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500 text-white font-bold h-10 rounded-xl text-sm shadow-lg"
                  >
                    Save & Broadcast Changes
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Multiplier Toggle */}
            <Button
              onClick={handleToggleMultiplier}
              variant="outline"
              className={`gap-1.5 h-10 rounded-xl text-xs font-bold transition-all ${
                isMultiplierActive
                  ? 'border-amber-500 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                  : 'border-slate-800 hover:bg-slate-900 text-slate-350'
              }`}
            >
              <Zap className={`w-4 h-4 ${isMultiplierActive ? 'text-amber-400 fill-amber-400' : 'text-slate-500'}`} />
              {isMultiplierActive ? '2x ON' : '2x'}
            </Button>

            {/* Host Announcement */}
            <Dialog open={isAnnouncementOpen} onOpenChange={setIsAnnouncementOpen}>
              <DialogTrigger
                render={
                  <Button variant="outline" className="border-slate-800 hover:bg-slate-900 text-slate-300 gap-1.5 h-10 rounded-xl text-xs">
                    <MessageSquare className="w-4 h-4 text-sky-400" />
                  </Button>
                }
              />
              <DialogContent className="bg-slate-950 border-slate-900 text-white max-w-sm rounded-2xl shadow-2xl">
                <DialogHeader>
                  <DialogTitle className="text-lg font-bold flex items-center gap-2 text-white">
                    <MessageSquare className="w-5 h-5 text-sky-500" /> Broadcast Announcement
                  </DialogTitle>
                  <DialogDescription className="text-slate-500 text-xs">
                    Send a message to all player screens instantly.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 mt-3">
                  <Input
                    value={announcementText}
                    onChange={(e) => setAnnouncementText(e.target.value)}
                    placeholder="Type your message..."
                    maxLength={120}
                    className="bg-slate-900 border-slate-800 text-white rounded-xl h-11 focus-visible:ring-sky-500"
                  />
                  <Button
                    onClick={handleSendAnnouncement}
                    className="w-full bg-sky-600 hover:bg-sky-500 text-white font-bold h-10 rounded-xl text-sm shadow-lg flex items-center justify-center gap-2"
                  >
                    <Send className="w-4 h-4" /> Send to All Players
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Activity Feed Toggle */}
            <Button
              onClick={() => setIsActivityOpen(!isActivityOpen)}
              variant="outline"
              className={`gap-1.5 h-10 rounded-xl text-xs ${isActivityOpen ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-slate-800 hover:bg-slate-900 text-slate-300'}`}
            >
              <Activity className={`w-4 h-4 ${isActivityOpen ? 'text-emerald-400' : 'text-slate-500'}`} />
              Feed
            </Button>

            {/* Add Time Button */}
            <Button
              onClick={handleAddTime}
              variant="outline"
              className="border-slate-800 hover:bg-slate-900 text-slate-350 gap-1.5 h-10 rounded-xl text-xs"
            >
              <Clock className="w-4 h-4 text-emerald-400" /> +10s
            </Button>

            {/* Pause / Resume Button */}
            <Button
              onClick={handleTogglePause}
              variant="outline"
              className="border-slate-800 hover:bg-slate-900 text-slate-350 gap-1.5 h-10 rounded-xl text-xs"
            >
              {session.status === 'question_paused' ? (
                <>
                  <Play className="w-4 h-4 text-emerald-400 fill-emerald-400/20" /> Resume
                </>
              ) : (
                <>
                  <Pause className="w-4 h-4 text-amber-400 fill-amber-400/20" /> Pause
                </>
              )}
            </Button>

            {/* Skip Button */}
            <Button
              onClick={handleRevealAnswer}
              className="bg-violet-600 hover:bg-violet-500 font-bold rounded-xl text-xs h-10 px-5 shadow-lg shadow-violet-500/10 flex items-center gap-1.5 text-white"
            >
              Skip Question <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Activity Feed Panel (collapsible) */}
        {isActivityOpen && (
          <div className="fixed top-0 right-0 h-full w-80 bg-slate-950/95 border-l border-slate-800 backdrop-blur-xl z-50 flex flex-col shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-emerald-400" /> Activity Feed
              </h3>
              <button type="button" onClick={() => setIsActivityOpen(false)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {activityFeed.length === 0 ? (
                <p className="text-slate-500 text-xs text-center py-8">No activity yet.</p>
              ) : (
                activityFeed.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2 p-2.5 bg-slate-900/60 border border-slate-800/60 rounded-xl">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                      entry.type === 'join' ? 'bg-emerald-500' :
                      entry.type === 'kick' ? 'bg-rose-500' :
                      entry.type === 'answer' ? 'bg-sky-500' :
                      entry.type === 'multiplier' ? 'bg-amber-500' :
                      entry.type === 'edit' ? 'bg-fuchsia-500' :
                      entry.type === 'jump' ? 'bg-violet-500' :
                      entry.type === 'announcement' ? 'bg-sky-500' :
                      'bg-slate-500'
                    }`} />
                    <div className="min-w-0">
                      <p className="text-xs text-slate-300 font-medium leading-snug">{entry.message}</p>
                      <p className="text-[9px] text-slate-600 mt-0.5">
                        {entry.time.toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // RENDER: QUESTION REVEAL STATE (BAR CHART)
  // ==========================================
  if (session.status === 'question_reveal') {
    if (!activeQuestion) return null;
    const totalVotes = revealData
      ? Object.values(revealData.optionCounts).reduce((a, b) => a + b, 0)
      : 0;

    return (
      <div
        className="relative min-h-screen w-full flex flex-col justify-between overflow-hidden font-sans p-6"
        style={customStyles}
      >
        <div className="flex items-center justify-between gap-4 z-10">
          <span className="text-sm font-black bg-emerald-600 px-3 py-1.5 rounded-xl uppercase tracking-wider text-white">
            Answers Revealed
          </span>
          <span className="text-slate-400 font-semibold text-xs">
            QuizArena Live Game
          </span>
        </div>

        <div className="my-6 text-center max-w-4xl mx-auto z-10">
          <h1 className="text-3xl font-black leading-tight text-white">
            {activeQuestion.prompt}
          </h1>
        </div>

        {/* Chart View */}
        <div className="flex-1 max-w-4xl mx-auto w-full flex flex-col items-center justify-center gap-8 z-10 py-6">
          <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-500">
            Player Answer Choices Distribution
          </h3>

          {/* Vertical Bar Chart */}
          <div className="flex items-end justify-center gap-6 h-64 sm:h-80 w-full max-w-2xl px-6 border-b border-slate-900 pb-1">
            {activeQuestion.answers.map((ans) => {
              const votes = revealData?.optionCounts[ans.id] || 0;
              const ratio = totalVotes > 0 ? votes / totalVotes : 0;
              const heightPercent = `${Math.max(5, ratio * 90)}%`; // minimum 5% height to show empty bars

              return (
                <div key={ans.id} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
                  <span className="font-mono text-sm font-black text-white bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                    {votes}
                  </span>
                  <div
                    className="w-full rounded-t-xl transition-all duration-500 shadow-lg relative flex items-center justify-center"
                    style={{
                      height: heightPercent,
                      backgroundColor: ans.color,
                    }}
                  >
                    {/* Visual checkmark inside correct choice bars */}
                    {ans.is_correct && (
                      <CheckCircle2 className="w-6 h-6 text-white bg-emerald-500 rounded-full border-2 border-white absolute top-[-12px]" />
                    )}
                  </div>
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-black"
                    style={{ backgroundColor: ans.color }}
                  >
                    {shapesMap[ans.shape] || '■'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Choices grid highlighting correct answer */}
        <div className="grid sm:grid-cols-2 gap-4 max-w-5xl w-full mx-auto mt-6 z-10">
          {activeQuestion.answers.map((ans) => {
            const isCorrect = ans.is_correct;
            return (
              <div
                key={ans.id}
                className={`flex items-center gap-3.5 border p-4 rounded-2xl select-none shadow-lg text-white font-bold text-lg transition-all ${
                  isCorrect
                    ? 'border-emerald-500 ring-4 ring-emerald-500/20 scale-100'
                    : 'opacity-30 border-slate-900/10'
                }`}
                style={{ backgroundColor: ans.color }}
              >
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl font-black">
                  {shapesMap[ans.shape] || '■'}
                </div>
                <span className="truncate flex-1">{ans.text}</span>
                {isCorrect && <CheckCircle2 className="w-6 h-6 text-emerald-300" />}
              </div>
            );
          })}
        </div>

        {/* Reveal controls footer */}
        <div className="flex items-center justify-between border-t border-slate-900/40 pt-4 mt-6 z-10">
          <span className="text-slate-500 text-xs font-semibold">
            Room PIN: {session.pin}
          </span>
          <Button
            onClick={handleShowLeaderboard}
            className="bg-violet-600 hover:bg-violet-500 font-bold rounded-xl text-xs h-10 px-5 shadow-lg shadow-violet-500/10 flex items-center gap-1.5 text-white"
          >
            Show Leaderboard <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER: LEADERBOARD STATE
  // ==========================================
  if (session.status === 'leaderboard') {
    const leaderboardPlayers = revealData?.leaderboard || players.slice(0, 5).sort((a, b) => b.score - a.score);

    return (
      <div
        className="relative min-h-screen w-full flex flex-col justify-between overflow-hidden font-sans p-6"
        style={customStyles}
      >
        <div className="flex items-center justify-between gap-4 z-10">
          <span className="text-sm font-black bg-indigo-600 px-3 py-1.5 rounded-xl uppercase tracking-wider text-white">
            Scoreboard
          </span>
          <span className="text-slate-400 font-semibold text-xs">
            QuizArena Live Game
          </span>
        </div>

        <div className="my-4 text-center z-10">
          <h1 className="text-4xl font-extrabold text-white tracking-tight">
            Leaderboard
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Top players for this round
          </p>
        </div>

        {/* Scoreboard List */}
        <div className="flex-1 max-w-xl mx-auto w-full flex flex-col justify-center gap-4 z-10 py-6">
          {leaderboardPlayers.map((playerRecord, rank) => {
            const isTop3 = rank < 3;
            const medals = ['🥇', '🥈', '🥉'];

            return (
              <div
                key={playerRecord.id}
                className="flex items-center justify-between p-4 bg-slate-900/60 border border-slate-800 rounded-2xl shadow-xl hover:border-slate-700 transition-colors duration-300"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <span className="font-extrabold text-lg text-slate-500 w-6 text-center">
                    {isTop3 ? medals[rank] : rank + 1}
                  </span>
                  <span className="font-extrabold text-lg text-white truncate max-w-[200px] sm:max-w-xs">
                    {playerRecord.nickname}
                  </span>
                  {playerRecord.streak > 1 && (
                    <span className="text-xs px-2.5 py-0.5 rounded-full border border-amber-500/20 bg-amber-950/20 text-amber-500 font-extrabold flex items-center gap-1">
                      <Flame className="w-3.5 h-3.5 fill-current" /> {playerRecord.streak}
                    </span>
                  )}
                </div>
                <span className="font-black text-xl text-violet-400 font-mono">
                  {playerRecord.score.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>

        {/* Leaderboard navigation footer */}
        <div className="flex items-center justify-between border-t border-slate-900/40 pt-4 mt-6 z-10">
          <span className="text-slate-500 text-xs font-semibold">
            Room PIN: {session.pin}
          </span>
          {isLastQuestion ? (
            <Button
              onClick={handleShowPodium}
              className="bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold rounded-xl text-xs h-10 px-5 shadow-lg shadow-violet-500/10 flex items-center gap-1.5"
            >
              Show Final Podium <Trophy className="w-4 h-4 text-amber-300" />
            </Button>
          ) : (
            <Button
              onClick={handleNextQuestion}
              className="bg-violet-600 hover:bg-violet-500 font-bold rounded-xl text-xs h-10 px-5 shadow-lg shadow-violet-500/10 flex items-center gap-1.5 text-white"
            >
              Next Question <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER: FINISHED STATE (PODIUM CELEBRATION)
  // ==========================================
  if (session.status === 'finished') {
    // Sort players to get winners
    const podiumWinners = [...players].sort((a, b) => b.score - a.score).slice(0, 3);
    const firstPlace = podiumWinners[0];
    const secondPlace = podiumWinners[1];
    const thirdPlace = podiumWinners[2];

    return (
      <div
        className="relative min-h-screen w-full flex flex-col justify-between overflow-hidden font-sans p-6 bg-slate-950"
      >
        {/* Glow */}
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-violet-900/20 blur-[150px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-rose-900/20 blur-[150px] pointer-events-none" />

        <div className="flex items-center justify-between gap-4 z-10">
          <span className="text-sm font-black bg-amber-600 px-3 py-1.5 rounded-xl uppercase tracking-wider text-white">
            Final Standings
          </span>
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500 animate-bounce" />
            <span className="text-slate-400 font-bold text-sm">Game Over</span>
          </div>
        </div>

        <div className="my-4 text-center z-10">
          <h1 className="text-4xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-fuchsia-500 to-rose-400 tracking-tight leading-none">
            QuizArena Podium
          </h1>
          <p className="text-slate-500 text-xs mt-2">
            Celebrating the champions of {quiz.title}!
          </p>
        </div>

        {/* 3D Podium Layout */}
        <div className="flex-1 max-w-3xl mx-auto w-full flex items-end justify-center gap-4 sm:gap-6 z-10 py-12">
          {/* 2nd Place Block (Left) */}
          {secondPlace && (
            <div className="flex flex-col items-center gap-3 w-1/4 min-w-[80px]">
              <div className="text-center w-full min-w-0">
                <span className="text-2xl" title="Silver Medal">🥈</span>
                <h3 className="font-extrabold text-sm sm:text-base text-white truncate w-full mt-1">
                  {secondPlace.nickname}
                </h3>
                <span className="font-mono text-xs text-violet-400 font-bold">
                  {secondPlace.score.toLocaleString()}
                </span>
              </div>
              <div className="bg-slate-900 border-x border-t border-slate-800 rounded-t-2xl w-full h-36 flex flex-col items-center justify-center shadow-xl">
                <span className="font-black text-4xl text-slate-500">2</span>
              </div>
            </div>
          )}

          {/* 1st Place Block (Center - Highest) */}
          {firstPlace && (
            <div className="flex flex-col items-center gap-3 w-1/3 min-w-[100px] z-10">
              <div className="text-center w-full min-w-0 flex flex-col items-center">
                <Trophy className="w-8 h-8 text-amber-400 fill-amber-400 animate-pulse" />
                <h3 className="font-black text-base sm:text-lg text-white truncate w-full mt-1.5">
                  {firstPlace.nickname}
                </h3>
                <span className="font-mono text-sm text-fuchsia-400 font-bold">
                  {firstPlace.score.toLocaleString()}
                </span>
              </div>
              <div className="bg-slate-900/90 border-x border-t border-slate-700/60 rounded-t-2xl w-full h-48 flex flex-col items-center justify-center shadow-2xl relative">
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-500 rounded-t-full" />
                <span className="font-black text-5xl text-amber-500">1</span>
              </div>
            </div>
          )}

          {/* 3rd Place Block (Right) */}
          {thirdPlace && (
            <div className="flex flex-col items-center gap-3 w-1/4 min-w-[80px]">
              <div className="text-center w-full min-w-0">
                <span className="text-2xl" title="Bronze Medal">🥉</span>
                <h3 className="font-extrabold text-sm sm:text-base text-white truncate w-full mt-1">
                  {thirdPlace.nickname}
                </h3>
                <span className="font-mono text-xs text-violet-400 font-bold">
                  {thirdPlace.score.toLocaleString()}
                </span>
              </div>
              <div className="bg-slate-900 border-x border-t border-slate-800 rounded-t-2xl w-full h-24 flex flex-col items-center justify-center shadow-xl">
                <span className="font-black text-4xl text-amber-700">3</span>
              </div>
            </div>
          )}
        </div>

        {/* Podium exit footer */}
        <div className="flex items-center justify-center border-t border-slate-900/40 pt-4 mt-6 z-10 w-full">
          <Button
            onClick={handleCloseSession}
            className="bg-slate-900 hover:bg-slate-800 border border-slate-800 font-bold rounded-xl text-xs h-12 px-6 flex items-center gap-2 text-white"
          >
            <Home className="w-4 h-4 text-violet-500" /> Return to Host Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
