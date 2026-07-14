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

// 7. Create a pre-made template quiz with 30 questions
export async function createTemplateQuiz() {
  try {
    const { supabase, user } = await getAuthUser();

    // Create the quiz shell
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .insert({
        host_id: user.id,
        title: 'أسئلة معلومات عامة',
        description: '30 سؤال متنوع – ديني، رياضي، علمي، جغرافي',
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

    if (quizError || !quiz) throw quizError;

    // Kahoot brand colors & shapes
    const C = ['#e21b3c', '#1368ce', '#d89e00', '#26890c', '#a855f7'];
    const S = ['triangle', 'diamond', 'circle', 'square', 'star'];

    type TQ = {
      prompt: string;
      answers: { text: string; correct: boolean }[];
    };

    const templateQuestions: TQ[] = [
      { prompt: 'ماهى المعجزة التى تدخلت فيها العذراء لإتمامها ؟', answers: [{ text: 'إقامة ابن أرملة نايين', correct: false }, { text: 'إشباع الجموع', correct: false }, { text: 'عرس قانا الجليل', correct: true }, { text: 'إقامة ابنة يايرس', correct: false }] },
      { prompt: 'ترتيب سفر العدد هو .....', answers: [{ text: '5', correct: false }, { text: '3', correct: false }, { text: '7', correct: false }, { text: '4', correct: true }] },
      { prompt: 'من الذى بشر العذراء ؟', answers: [{ text: 'الملاك جبرائيل', correct: true }, { text: 'الملاك سوريال', correct: false }, { text: 'الملاك روفائيل', correct: false }, { text: 'الملاك ميخائيل', correct: false }] },
      { prompt: 'هوذا العذراء تحبل و تلد ابناً و تدعو اسمه عمانوئيل نبوة جاءت فى ......', answers: [{ text: 'إرميا', correct: false }, { text: 'حزقيال', correct: false }, { text: 'دانيال', correct: false }, { text: 'إشعياء', correct: true }] },
      { prompt: 'ما هى الرسالة التي تسمى برسالة الفرح ؟', answers: [{ text: 'كورنثوس الثانية', correct: false }, { text: 'فيلبى', correct: true }, { text: 'فليمون', correct: false }, { text: 'تيموثاوس الأولى', correct: false }] },
      { prompt: 'فى أى جبل رأى موسى العليقة المحترقة ؟', answers: [{ text: 'أراراط', correct: false }, { text: 'حوريب', correct: true }, { text: 'الزيتون', correct: false }, { text: 'سيناء', correct: false }] },
      { prompt: 'أين كان يوحنا عندما أوحى إليه بسفر الرؤيا ؟', answers: [{ text: 'جزيرة مالطة', correct: false }, { text: 'جزيرة قبرص', correct: false }, { text: 'جزيرة كريت', correct: false }, { text: 'جزيرة بطمس', correct: true }] },
      { prompt: 'ما هو أول وعد من الله للبشر ؟', answers: [{ text: 'نسل المرأة يسحق رأس الحية', correct: true }, { text: 'أكرم أباك و أمك', correct: false }, { text: 'دخول أرض كنعان', correct: false }, { text: 'هاتوا العشور و جربونى', correct: false }] },
      { prompt: 'من الذى سمى يوحنا المعمدان بهذا الإسم ؟', answers: [{ text: 'زكريا', correct: false }, { text: 'الملاك', correct: true }, { text: 'المسيح', correct: false }, { text: 'أليصابات', correct: false }] },
      { prompt: 'ما هى أول طوبى نطق بها السيد المسيح ؟', answers: [{ text: 'طوبى للمساكين بالروح', correct: true }, { text: 'طوبى للودعاء', correct: false }, { text: 'طوبى للباكين و العطاشى إلى البر', correct: false }, { text: 'طوبى للحزانى', correct: false }] },
      { prompt: 'من هو الراعي الصغير الذي قتل أسدآ ؟', answers: [{ text: 'شمشون', correct: false }, { text: 'عاموس', correct: false }, { text: 'جدعون', correct: false }, { text: 'داود', correct: true }] },
      { prompt: 'من هو المنتخب الذى فاز ببطولة كأس العالم مرتين متتاليتين ؟', answers: [{ text: 'البرازيل', correct: false }, { text: 'ألمانيا', correct: false }, { text: 'إيطاليا', correct: false }, { text: 'فرنسا', correct: false }, { text: 'البرازيل و إيطاليا', correct: true }] },
      { prompt: 'عدد أفراد فريق كرة الماء ؟', answers: [{ text: '6 لاعبين', correct: false }, { text: '5 لاعبين', correct: false }, { text: '8 لاعبين', correct: false }, { text: '7 لاعبين', correct: true }] },
      { prompt: 'تشتهر مصارعة الثيران في أي دولة؟', answers: [{ text: 'فرنسا', correct: false }, { text: 'إسبانيا', correct: true }, { text: 'كوستاريكا', correct: false }, { text: 'إيطاليا', correct: false }] },
      { prompt: 'أى الوحدات التالية هى الأكبر ؟', answers: [{ text: 'جيجا', correct: false }, { text: 'تيرا', correct: true }, { text: 'بايت', correct: false }, { text: 'ميجا', correct: false }] },
      { prompt: 'أين تقع غابات الأمازون ؟', answers: [{ text: 'آسيا', correct: false }, { text: 'أمريكا', correct: true }, { text: 'أوروبا', correct: false }, { text: 'أستراليا', correct: false }] },
      { prompt: 'ما هى القارة العجوز ؟', answers: [{ text: 'أوروبا', correct: true }, { text: 'إفريقيا', correct: false }, { text: 'أستراليا', correct: false }, { text: 'آسيا', correct: false }] },
      { prompt: 'الدولة التى إستضافت كأس العالم سنة 1990؟', answers: [{ text: 'ألمانيا', correct: false }, { text: 'البرتغال', correct: false }, { text: 'إيطاليا', correct: true }, { text: 'البرازيل', correct: false }] },
      { prompt: 'مكتشف قاعدة طفو الأجسام هو', answers: [{ text: 'أرشميدس', correct: true }, { text: 'نيوتن', correct: false }, { text: 'أينشتاين', correct: false }, { text: 'أديسون', correct: false }] },
      { prompt: 'أى من الغازات التالية يستخدم في إطفاء الحرائق ؟', answers: [{ text: 'ثانى أكسيد الكربون', correct: true }, { text: 'الأكسجين', correct: false }, { text: 'الهيدروجين', correct: false }, { text: 'النيتروجين', correct: false }] },
      { prompt: 'ما هى عدد فقرات جسم الإنسان ؟', answers: [{ text: '33 فقرة', correct: true }, { text: '30 فقرة', correct: false }, { text: '28 فقرة', correct: false }, { text: '32 فقرة', correct: false }] },
      { prompt: 'من الذي استعمل أشعة الشمس كسلاح في الحرب و قضى بها على الأسطول الروماني ؟', answers: [{ text: 'أرشميدس', correct: true }, { text: 'نيوتن', correct: false }, { text: 'أديسون', correct: false }, { text: 'جاليليو', correct: false }] },
      { prompt: 'ما هى المادة المسؤلة عن تلون الجسم باللون الداكن ؟', answers: [{ text: 'الميلانين', correct: true }, { text: 'السيروتونين', correct: false }, { text: 'الدوبامين', correct: false }, { text: 'النيوماسيسين', correct: false }] },
      { prompt: 'ما هى أكبر جزيرة فى البحر المتوسط ؟', answers: [{ text: 'جزيرة صقلية', correct: true }, { text: 'جزيرة كريت', correct: false }, { text: 'جزيرة قبرص', correct: false }, { text: 'جزيرة مالطة', correct: false }] },
      { prompt: 'أعلى قمة جبل في إفريقيا ؟', answers: [{ text: 'كلمنجارو', correct: true }, { text: 'إفرست', correct: false }, { text: 'الألب', correct: false }, { text: 'هيمالايا', correct: false }] },
      { prompt: 'ما هى الدولة التى استضافت كأس العالم 1998 ؟', answers: [{ text: 'فرنسا', correct: true }, { text: 'البرازيل', correct: false }, { text: 'الأرجنتين', correct: false }, { text: 'ألمانيا', correct: false }] },
      { prompt: 'أين يقع مقر منظمة الصحة العالمية ؟', answers: [{ text: 'جنيف', correct: true }, { text: 'لندن', correct: false }, { text: 'روما', correct: false }, { text: 'نيويورك', correct: false }] },
      { prompt: 'ما هى عاصمة تايلاند ؟', answers: [{ text: 'بانكوك', correct: true }, { text: 'طوكيو', correct: false }, { text: 'بكين', correct: false }, { text: 'كييف', correct: false }] },
      { prompt: 'ما هو أضخم الحيوانات اللا فقارية ؟', answers: [{ text: 'الحبار', correct: true }, { text: 'الأخطبوط', correct: false }, { text: 'الإستاكوزا', correct: false }, { text: 'الحلزون', correct: false }] },
      { prompt: 'أبعد كوكب عن الأرض فى المذكورين', answers: [{ text: 'أورانوس', correct: true }, { text: 'المشترى', correct: false }, { text: 'زحل', correct: false }, { text: 'عطارد', correct: false }] },
    ];

    // Build DB rows
    const questionRows = templateQuestions.map((q, idx) => ({
      quiz_id: quiz.id,
      order_index: idx,
      type: 'mcq',
      prompt: q.prompt,
      media_url: null,
      media_type: null,
      time_limit_seconds: 20,
      points_base: 1000,
      scoring_type: 'linear',
      answers: q.answers.map((a, ai) => ({
        id: String(ai + 1),
        text: a.text,
        is_correct: a.correct,
        color: C[ai % C.length],
        shape: S[ai % S.length],
      })),
    }));

    const { error: insertError } = await supabase
      .from('questions')
      .insert(questionRows);

    if (insertError) throw insertError;

    revalidatePath('/dashboard');
    return quiz;
  } catch (err: unknown) {
    console.error('createTemplateQuiz error:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to create template quiz.');
  }
}
