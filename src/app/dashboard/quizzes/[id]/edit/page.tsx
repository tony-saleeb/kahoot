import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import QuizEditorClient from '@/app/dashboard/quizzes/[id]/edit/QuizEditorClient';

export const dynamic = 'force-dynamic';

interface EditQuizPageProps {
  params: {
    id: string;
  };
}

export default async function EditQuizPage({ params }: EditQuizPageProps) {
  const { id: quizId } = params;
  const supabase = createClient();

  // Get current authenticated user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect('/');
  }

  // Fetch quiz details
  const { data: quiz, error: quizError } = await supabase
    .from('quizzes')
    .select('*')
    .eq('id', quizId)
    .eq('host_id', user.id)
    .single();

  if (quizError || !quiz) {
    // If not found or unauthorized, redirect back to dashboard
    redirect('/dashboard');
  }

  // Fetch questions sorted by order_index
  const { data: questions, error: questionsError } = await supabase
    .from('questions')
    .select('*')
    .eq('quiz_id', quizId)
    .order('order_index', { ascending: true });

  if (questionsError) {
    console.error('Error fetching quiz questions:', questionsError);
  }

  return (
    <QuizEditorClient
      quiz={quiz}
      initialQuestions={questions || []}
    />
  );
}
