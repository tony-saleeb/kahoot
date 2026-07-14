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

  // Run auth check and session fetch in parallel
  const [authResult, sessionResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from('game_sessions')
      .select('*')
      .eq('id', sessionId)
      .single(),
  ]);

  const { data: { user }, error: authError } = authResult;
  if (authError || !user) {
    redirect('/');
  }

  const { data: session, error: sessionError } = sessionResult;
  if (sessionError || !session || session.host_id !== user.id) {
    redirect('/dashboard');
  }

  // Fetch quiz, questions, and players all in parallel
  const [quizResult, questionsResult, playersResult] = await Promise.all([
    supabase
      .from('quizzes')
      .select('*')
      .eq('id', session.quiz_id)
      .single(),
    supabase
      .from('questions')
      .select('*')
      .eq('quiz_id', session.quiz_id)
      .order('order_index', { ascending: true }),
    supabase
      .from('players')
      .select('*')
      .eq('session_id', sessionId)
      .order('joined_at', { ascending: true }),
  ]);

  const { data: quiz, error: quizError } = quizResult;
  if (quizError || !quiz) {
    redirect('/dashboard');
  }

  if (questionsResult.error) {
    console.error('Error fetching questions:', questionsResult.error);
  }
  if (playersResult.error) {
    console.error('Error fetching players:', playersResult.error);
  }

  return (
    <HostGameClient
      initialSession={session}
      quiz={quiz}
      questions={questionsResult.data || []}
      initialPlayers={playersResult.data || []}
    />
  );
}
