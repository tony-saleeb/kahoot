// Force TS cache refresh
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import HostGameClient from '@/app/host/[sessionId]/HostGameClient';

export const dynamic = 'force-dynamic';

interface HostSessionPageProps {
  params: {
    sessionId: string;
  };
}

export default async function HostSessionPage({ params }: HostSessionPageProps) {
  const { sessionId } = params;
  const supabase = createClient();

  // Get current authenticated user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect('/');
  }

  // Fetch game session
  const { data: session, error: sessionError } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('host_id', user.id)
    .single();

  if (sessionError || !session) {
    redirect('/dashboard');
  }

  // Fetch quiz settings
  const { data: quiz, error: quizError } = await supabase
    .from('quizzes')
    .select('*')
    .eq('id', session.quiz_id)
    .single();

  if (quizError || !quiz) {
    redirect('/dashboard');
  }

  // Fetch questions
  const { data: questions, error: questionsError } = await supabase
    .from('questions')
    .select('*')
    .eq('quiz_id', quiz.id)
    .order('order_index', { ascending: true });

  if (questionsError) {
    console.error('Error fetching questions:', questionsError);
  }

  // Fetch players already in room
  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('*')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true });

  if (playersError) {
    console.error('Error fetching players:', playersError);
  }

  return (
    <HostGameClient
      initialSession={session}
      quiz={quiz}
      questions={questions || []}
      initialPlayers={players || []}
    />
  );
}
