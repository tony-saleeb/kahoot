import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

interface AnswerOption {
  id: string;
  text: string;
  color: string;
  shape: string;
  is_correct?: boolean;
}

export async function POST(request: Request) {
  try {
    const { sessionId, playerId, token, questionId, selectedAnswerIds, multiplier: clientMultiplier } = await request.json();

    if (!sessionId || !playerId || !token || !questionId || !selectedAnswerIds) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const adminSupabase = createAdminClient();

    // 1. Verify Player Token
    const { data: player, error: playerError } = await adminSupabase
      .from('players')
      .select('id, client_token, score, streak')
      .eq('id', playerId)
      .single();

    if (playerError || !player || player.client_token !== token) {
      return NextResponse.json({ error: 'Unauthorized. Invalid player token.' }, { status: 401 });
    }

    // 2. Fetch Session & Verify Active Status
    const { data: session, error: sessionError } = await adminSupabase
      .from('game_sessions')
      .select('status, current_question_index, question_started_at, quiz_id')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Game session not found.' }, { status: 404 });
    }

    if (session.status !== 'question_active') {
      return NextResponse.json({ error: 'Submissions are closed for this round.' }, { status: 403 });
    }

    // 3. Fetch Question Details
    const { data: question, error: questionError } = await adminSupabase
      .from('questions')
      .select('*')
      .eq('id', questionId)
      .eq('quiz_id', session.quiz_id)
      .single();

    if (questionError || !question) {
      return NextResponse.json({ error: 'Question not found.' }, { status: 404 });
    }

    // 3b. Validate multiplier against quiz's double_points_rounds config
    let validatedMultiplier = 1;
    if (clientMultiplier && clientMultiplier === 2) {
      const { data: quizConfig } = await adminSupabase
        .from('quizzes')
        .select('double_points_rounds')
        .eq('id', session.quiz_id)
        .single();

      // Allow multiplier if the quiz has double_points_rounds configured,
      // or if the host dynamically activated it (check current question index)
      const doubleRounds = (quizConfig?.double_points_rounds as string[]) || [];
      const currentIndex = session.current_question_index;
      if (
        doubleRounds.includes(questionId) ||
        doubleRounds.includes(String(currentIndex)) ||
        doubleRounds.length === 0 // When empty, host can dynamically toggle per round
      ) {
        validatedMultiplier = 2;
      }
    }

    // 4. Check if player has already submitted
    const { data: existingSubmission } = await adminSupabase
      .from('answers_submitted')
      .select('id')
      .eq('session_id', sessionId)
      .eq('question_id', questionId)
      .eq('player_id', playerId)
      .maybeSingle();

    if (existingSubmission) {
      return NextResponse.json({ error: 'Answer already submitted for this question.' }, { status: 400 });
    }

    // 5. Calculate Timing (Anti-Cheat Server-Side timing)
    const serverReceivedAt = new Date();
    const startedAt = new Date(session.question_started_at);
    const timeTakenMs = serverReceivedAt.getTime() - startedAt.getTime();
    const timeLimitMs = question.time_limit_seconds * 1000;

    // 1.5 second latency grace period
    const isLate = timeTakenMs > (timeLimitMs + 1500);

    // 6. Grade Correctness
    let isCorrect = false;
    const correctOptions = (question.answers as AnswerOption[])?.filter((ans) => ans.is_correct) || [];

    if (isLate) {
      isCorrect = false;
    } else if (question.type === 'poll') {
      // Poll has no points or correctness, but is valid
      isCorrect = false;
    } else if (question.type === 'mcq' || question.type === 'true_false') {
      const selectedId = selectedAnswerIds[0];
      const correctId = correctOptions[0]?.id;
      isCorrect = selectedId === correctId;
    } else if (question.type === 'multi_select') {
      // All correct options must be selected, and no incorrect options selected
      const correctIds = correctOptions.map((opt) => opt.id).sort();
      const submittedIds = [...selectedAnswerIds].sort();
      isCorrect =
        correctIds.length === submittedIds.length &&
        correctIds.every((id, idx) => id === submittedIds[idx]);
    } else if (question.type === 'type_answer') {
      // Free-text fuzzy matching. Split correct options by semicolon.
      const submittedText = (selectedAnswerIds[0] || '').trim().toLowerCase();
      const correctAlternatives = (correctOptions[0]?.text || '')
        .split(';')
        .map((t: string) => t.trim().toLowerCase());
      isCorrect = correctAlternatives.includes(submittedText);
    }

    // 7. Calculate Points Awarded (Linear Decay vs. Flat Points vs. None)
    let pointsAwarded = 0;
    let newStreak = player.streak;

    if (isCorrect && !isLate) {
      newStreak += 1;
      const basePoints = question.points_base;

      if (question.scoring_type === 'linear') {
        const ratio = Math.max(0, Math.min(1, timeTakenMs / timeLimitMs));
        const decay = 1 - 0.5 * ratio;
        pointsAwarded = Math.round(basePoints * decay);
      } else if (question.scoring_type === 'flat') {
        pointsAwarded = basePoints;
      } else {
        pointsAwarded = 0;
      }

      // Add streak bonus (+50 per consecutive correct, capped at +250)
      const streakBonus = Math.min(250, (newStreak - 1) * 50);
      pointsAwarded += streakBonus;

      // Apply validated multiplier (2x if host activated double points for this round)
      pointsAwarded = Math.round(pointsAwarded * validatedMultiplier);
    } else {
      newStreak = 0; // reset streak
      pointsAwarded = 0;
    }

    // 8. Record the submission in database
    const { error: insertError } = await adminSupabase
      .from('answers_submitted')
      .insert({
        session_id: sessionId,
        question_id: questionId,
        player_id: playerId,
        selected_answer_ids: selectedAnswerIds,
        time_taken_ms: timeTakenMs,
        points_awarded: pointsAwarded,
        is_correct: isCorrect,
      });

    if (insertError) {
      throw insertError;
    }

    return NextResponse.json({
      success: true,
      message: 'Answer submitted successfully.',
    });
  } catch (err: unknown) {
    console.error('Answer submission error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
