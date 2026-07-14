// Force TS cache refresh
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PlayerGameClient from '@/app/play/[sessionId]/PlayerGameClient';

export const dynamic = 'force-dynamic';

interface PlayerSessionPageProps {
  params: {
    sessionId: string;
  };
}

export default async function PlayerSessionPage({ params }: PlayerSessionPageProps) {
  const { sessionId } = params;
  const supabase = createClient();

  // Fetch session and associated quiz theme
  const { data: session, error } = await supabase
    .from('game_sessions')
    .select('*, quizzes(theme)')
    .eq('id', sessionId)
    .single();

  if (error || !session) {
    redirect('/play');
  }

  if (session.status === 'finished') {
    redirect('/play');
  }

  const sessionWithQuiz = session as unknown as { quizzes: { theme: Record<string, unknown> } | null };
  const theme = sessionWithQuiz?.quizzes?.theme || null;

  return (
    <PlayerGameClient
      sessionId={sessionId}
      initialSessionStatus={session.status}
      quizTheme={theme}
    />
  );
}
