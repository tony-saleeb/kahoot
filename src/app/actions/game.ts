'use server';

import { createClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';

// Helper to get authenticated user
async function getAuthUser() {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error('Unauthorized. Please log in.');
  }
  return { supabase, user };
}

// Generate a unique 6-digit PIN code
async function generateUniquePin(supabase: SupabaseClient): Promise<string> {
  let pin = '';
  let isUnique = false;
  let attempts = 0;

  while (!isUnique && attempts < 10) {
    attempts++;
    // Generate random 6-digit code
    pin = Math.floor(100000 + Math.random() * 900000).toString();

    // Check if there is an active room with this PIN
    const { data, error } = await supabase
      .from('game_sessions')
      .select('id')
      .eq('pin', pin)
      .neq('status', 'finished')
      .maybeSingle();

    if (!data && !error) {
      isUnique = true;
    }
  }

  if (!isUnique) {
    throw new Error('Failed to generate a unique PIN code. Please try again.');
  }

  return pin;
}

// Create a new game session
export async function createGameSession(quizId: string) {
  try {
    const { supabase, user } = await getAuthUser();

    // 1. Verify quiz exists and belongs to host
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select('id')
      .eq('id', quizId)
      .eq('host_id', user.id)
      .single();

    if (quizError || !quiz) {
      throw new Error('Quiz not found or unauthorized.');
    }

    // 2. Generate unique PIN
    const pin = await generateUniquePin(supabase);

    // 3. Insert game session row
    const { data: session, error: sessionError } = await supabase
      .from('game_sessions')
      .insert({
        quiz_id: quizId,
        host_id: user.id,
        pin,
        status: 'lobby',
        current_question_index: 0,
      })
      .select()
      .single();

    if (sessionError || !session) {
      throw sessionError || new Error('Failed to create game session.');
    }

    return session;
  } catch (err) {
    console.error('createGameSession error:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to start game room.');
  }
}

// End a game session early or manually
export async function endGameSession(sessionId: string) {
  try {
    const { supabase, user } = await getAuthUser();

    const { error } = await supabase
      .from('game_sessions')
      .update({ status: 'finished' })
      .eq('id', sessionId)
      .eq('host_id', user.id);

    if (error) throw error;

    return { success: true };
  } catch (err) {
    console.error('endGameSession error:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to terminate game room.');
  }
}

// Kick a player from a session
export async function kickPlayer(playerId: string, sessionId: string) {
  try {
    const { supabase, user } = await getAuthUser();

    // Verify host owns this session
    const { data: session, error: sessionError } = await supabase
      .from('game_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('host_id', user.id)
      .single();

    if (sessionError || !session) {
      throw new Error('Unauthorized or session not found.');
    }

    // Delete player row
    const { error } = await supabase
      .from('players')
      .delete()
      .eq('id', playerId)
      .eq('session_id', sessionId);

    if (error) throw error;

    return { success: true };
  } catch (err) {
    console.error('kickPlayer error:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to kick player.');
  }
}

// Update player connection status safely (bypassing RLS by validating token)
export async function updatePlayerConnection(playerId: string, token: string, connected: boolean) {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const adminSupabase = createAdminClient();

    // Fetch player to verify token
    const { data: player, error: fetchError } = await adminSupabase
      .from('players')
      .select('client_token')
      .eq('id', playerId)
      .single();

    if (fetchError || !player || player.client_token !== token) {
      throw new Error('Unauthorized or player not found.');
    }

    // Update connection state
    const { error: updateError } = await adminSupabase
      .from('players')
      .update({ connected })
      .eq('id', playerId);

    if (updateError) throw updateError;
    return { success: true };
  } catch (err) {
    console.error('updatePlayerConnection error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Failed to update connection.' };
  }
}

// 6. Calculate round score adjustments and shift status to 'question_reveal'
export async function revealQuestionResults(sessionId: string, questionId: string) {
  try {
    const { supabase, user } = await getAuthUser();

    // Verify session ownership
    const { data: session, error: sessionError } = await supabase
      .from('game_sessions')
      .select('id, quiz_id')
      .eq('id', sessionId)
      .eq('host_id', user.id)
      .single();

    if (sessionError || !session) {
      throw new Error('Unauthorized or session not found.');
    }

    // Fetch players in session
    const { data: players, error: playersError } = await supabase
      .from('players')
      .select('*')
      .eq('session_id', sessionId);

    if (playersError || !players) throw playersError;

    // Fetch all submissions for this question
    const { data: submissions, error: subsError } = await supabase
      .from('answers_submitted')
      .select('*')
      .eq('session_id', sessionId)
      .eq('question_id', questionId);

    if (subsError) throw subsError;

    // Update each player's score and streak in DB
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const adminSupabase = createAdminClient();

    for (const player of players) {
      const sub = submissions?.find((s) => s.player_id === player.id);
      
      let updatedScore = player.score;
      let updatedStreak = player.streak;

      if (sub) {
        updatedScore += sub.points_awarded;
        updatedStreak = sub.is_correct ? player.streak + 1 : 0;
      } else {
        updatedStreak = 0; // reset streak if didn't answer
      }

      // Save player updates
      const { error: updateError } = await adminSupabase
        .from('players')
        .update({
          score: updatedScore,
          streak: updatedStreak,
        })
        .eq('id', player.id);

      if (updateError) throw updateError;
    }

    // Update session status to 'question_reveal'
    const { error: statusError } = await supabase
      .from('game_sessions')
      .update({ status: 'question_reveal' })
      .eq('id', sessionId);

    if (statusError) throw statusError;

    // Calculate answer option statistics
    const optionCounts: Record<string, number> = {};
    submissions?.forEach((sub) => {
      const selected = sub.selected_answer_ids as string[];
      selected.forEach((id) => {
        optionCounts[id] = (optionCounts[id] || 0) + 1;
      });
    });

    // Fetch top 5 leaderboard
    const { data: leaderboard, error: leaderboardError } = await supabase
      .from('players')
      .select('id, nickname, score, streak, connected')
      .eq('session_id', sessionId)
      .order('score', { ascending: false })
      .limit(5);

    if (leaderboardError) throw leaderboardError;

    return {
      optionCounts,
      leaderboard: leaderboard || [],
    };
  } catch (err) {
    console.error('revealQuestionResults error:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to reveal round answers.');
  }
}

// Transition status to 'leaderboard'
export async function goToLeaderboard(sessionId: string) {
  try {
    const { supabase, user } = await getAuthUser();
    const { error } = await supabase
      .from('game_sessions')
      .update({ status: 'leaderboard' })
      .eq('id', sessionId)
      .eq('host_id', user.id);

    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error('goToLeaderboard error:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to open leaderboard.');
  }
}

// Transition session to next active question
export async function goToNextQuestion(sessionId: string, nextIndex: number) {
  try {
    const { supabase, user } = await getAuthUser();
    const { error } = await supabase
      .from('game_sessions')
      .update({
        status: 'question_active',
        current_question_index: nextIndex,
        question_started_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('host_id', user.id);

    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error('goToNextQuestion error:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to open next question.');
  }
}

// Transition status to final 'finished' podium
export async function goToPodium(sessionId: string) {
  try {
    const { supabase, user } = await getAuthUser();
    const { error } = await supabase
      .from('game_sessions')
      .update({ status: 'finished' })
      .eq('id', sessionId)
      .eq('host_id', user.id);

    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error('goToPodium error:', err);
    throw new Error(err instanceof Error ? err.message : 'Failed to display podium.');
  }
}




