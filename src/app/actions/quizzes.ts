'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

interface AnswerOptionInput {
  id: string;
  text: string;
  is_correct: boolean;
  color: string;
  shape: string;
  image_url?: string;
}

interface QuestionInput {
  id?: string;
  type: string;
  prompt: string;
  media_url: string | null;
  media_type: string | null;
  time_limit_seconds: number;
  points_base: number;
  scoring_type: string;
  answers: AnswerOptionInput[];
}

interface QuizSettingsInput {
  title: string;
  description: string;
  theme: Record<string, unknown>;
  randomize_questions: boolean;
  randomize_answers: boolean;
  team_mode: boolean;
  double_points_rounds: string[];
}

// Helper to get authenticated user
async function getAuthUser() {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error('Unauthorized. Please log in.');
  }
  return { supabase, user };
}

// 1. Get all quizzes for the logged-in host
export async function getQuizzes() {
  try {
    const { supabase, user } = await getAuthUser();
    const { data, error } = await supabase
      .from('quizzes')
      .select('*, questions(count)')
      .eq('host_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  } catch (err: unknown) {
    console.error('getQuizzes error:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to fetch quizzes.');
  }
}

// 2. Create a new empty quiz
export async function createQuiz(title: string, description: string = '') {
  try {
    const { supabase, user } = await getAuthUser();
    const { data, error } = await supabase
      .from('quizzes')
      .insert({
        host_id: user.id,
        title,
        description,
        theme: {
          bgColor: '#0f172a',
          textColor: '#ffffff',
          primaryColor: '#6366f1',
          accentColor: '#ec4899',
          fontFamily: 'Inter',
        },
      })
      .select()
      .single();

    if (error) throw error;
    revalidatePath('/dashboard');
    return data;
  } catch (err: unknown) {
    console.error('createQuiz error:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to create quiz.');
  }
}

// 3. Delete a quiz
export async function deleteQuiz(quizId: string) {
  try {
    const { supabase, user } = await getAuthUser();
    const { error } = await supabase
      .from('quizzes')
      .delete()
      .eq('id', quizId)
      .eq('host_id', user.id);

    if (error) throw error;
    revalidatePath('/dashboard');
    return { success: true };
  } catch (err: unknown) {
    console.error('deleteQuiz error:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to delete quiz.');
  }
}

// 4. Clone / Duplicate a quiz along with all its questions
export async function cloneQuiz(quizId: string) {
  try {
    const { supabase, user } = await getAuthUser();

    // Fetch original quiz details
    const { data: originalQuiz, error: quizError } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', quizId)
      .eq('host_id', user.id)
      .single();

    if (quizError || !originalQuiz) throw new Error('Quiz not found.');

    // Fetch original questions
    const { data: originalQuestions, error: questionsError } = await supabase
      .from('questions')
      .select('*')
      .eq('quiz_id', quizId)
      .order('order_index', { ascending: true });

    if (questionsError) throw questionsError;

    // Create cloned quiz
    const { data: newQuiz, error: cloneQuizError } = await supabase
      .from('quizzes')
      .insert({
        host_id: user.id,
        title: `${originalQuiz.title} (Copy)`,
        description: originalQuiz.description,
        cover_image_url: originalQuiz.cover_image_url,
        theme: originalQuiz.theme,
        randomize_questions: originalQuiz.randomize_questions,
        randomize_answers: originalQuiz.randomize_answers,
        team_mode: originalQuiz.team_mode,
        double_points_rounds: originalQuiz.double_points_rounds,
      })
      .select()
      .single();

    if (cloneQuizError || !newQuiz) throw cloneQuizError;

    // Insert cloned questions if any exist
    if (originalQuestions && originalQuestions.length > 0) {
      const clonedQuestionsData = originalQuestions.map((q) => ({
        quiz_id: newQuiz.id,
        order_index: q.order_index,
        type: q.type,
        prompt: q.prompt,
        media_url: q.media_url,
        media_type: q.media_type,
        time_limit_seconds: q.time_limit_seconds,
        points_base: q.points_base,
        scoring_type: q.scoring_type,
        answers: q.answers,
      }));

      const { error: insertQuestionsError } = await supabase
        .from('questions')
        .insert(clonedQuestionsData);

      if (insertQuestionsError) throw insertQuestionsError;
    }

    revalidatePath('/dashboard');
    return newQuiz;
  } catch (err: unknown) {
    console.error('cloneQuiz error:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to clone quiz.');
  }
}

// 5. Fetch a quiz and its questions for editing
export async function getQuizForEdit(quizId: string) {
  try {
    const { supabase, user } = await getAuthUser();

    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', quizId)
      .eq('host_id', user.id)
      .single();

    if (quizError || !quiz) throw new Error('Quiz not found.');

    const { data: questions, error: questionsError } = await supabase
      .from('questions')
      .select('*')
      .eq('quiz_id', quizId)
      .order('order_index', { ascending: true });

    if (questionsError) throw questionsError;

    return { quiz, questions: (questions || []) as unknown as QuestionInput[] };
  } catch (err: unknown) {
    console.error('getQuizForEdit error:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to load quiz details.');
  }
}

// 6. Batch save quiz settings and questions
export async function saveQuizData(
  quizId: string,
  settings: QuizSettingsInput,
  questions: QuestionInput[]
) {
  try {
    const { supabase, user } = await getAuthUser();

    // 1. Verify quiz ownership and update settings
    const { error: updateQuizError } = await supabase
      .from('quizzes')
      .update({
        title: settings.title,
        description: settings.description,
        theme: settings.theme,
        randomize_questions: settings.randomize_questions,
        randomize_answers: settings.randomize_answers,
        team_mode: settings.team_mode,
        double_points_rounds: settings.double_points_rounds,
        updated_at: new Date().toISOString(),
      })
      .eq('id', quizId)
      .eq('host_id', user.id);

    if (updateQuizError) throw updateQuizError;

    // 2. Fetch existing question IDs to identify deletions
    const { data: existingQs, error: fetchQsError } = await supabase
      .from('questions')
      .select('id')
      .eq('quiz_id', quizId);

    if (fetchQsError) throw fetchQsError;

    const existingIds = existingQs?.map((q) => q.id) || [];
    const incomingIds = questions.map((q) => q.id).filter((id): id is string => !!id);
    const deleteIds = existingIds.filter((id) => !incomingIds.includes(id));

    // 3. Perform Deletions
    if (deleteIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('questions')
        .delete()
        .in('id', deleteIds);
      if (deleteError) throw deleteError;
    }

    // 4. Perform Updates & Insertions
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qData = {
        quiz_id: quizId,
        order_index: i,
        type: q.type,
        prompt: q.prompt,
        media_url: q.media_url,
        media_type: q.media_type,
        time_limit_seconds: q.time_limit_seconds,
        points_base: q.points_base,
        scoring_type: q.scoring_type,
        answers: q.answers,
      };

      if (q.id && existingIds.includes(q.id)) {
        // Update existing question
        const { error: updateError } = await supabase
          .from('questions')
          .update(qData)
          .eq('id', q.id);
        if (updateError) throw updateError;
      } else {
        // Insert new question
        const { error: insertError } = await supabase
          .from('questions')
          .insert(qData);
        if (insertError) throw insertError;
      }
    }

    return { success: true };
  } catch (err: unknown) {
    console.error('saveQuizData error:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to save quiz.');
  }
}
