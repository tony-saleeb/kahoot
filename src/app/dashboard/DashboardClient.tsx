'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  createQuiz,
  deleteQuiz,
  cloneQuiz,
} from '@/app/actions/quizzes';
import { createGameSession } from '@/app/actions/game';
import {
  Flame,
  Plus,
  Play,
  Edit,
  Copy,
  Trash2,
  Calendar,
  Layers,
  LogOut,
} from 'lucide-react';

interface Quiz {
  id: string;
  title: string;
  description: string;
  cover_image_url: string | null;
  theme: Record<string, unknown> | null;
  created_at: string;
  questions?: { count: number }[];
}

interface DashboardClientProps {
  initialQuizzes: Quiz[];
  user: User;
}

export default function DashboardClient({
  initialQuizzes,
  user,
}: DashboardClientProps) {
  const router = useRouter();
  const supabase = createClient();
  const [quizzes, setQuizzes] = useState<Quiz[]>(initialQuizzes);

  // Dialog & Form State
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Logout Handler
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      toast.success('Logged out successfully.');
      router.push('/');
      router.refresh();
    } catch (err) {
      console.error('Logout error:', err);
      toast.error('Failed to log out.');
    }
  };

  // Create Quiz Handler
  const handleCreateQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Quiz title is required.');
      return;
    }
    setActionLoading(true);

    try {
      const newQuiz = await createQuiz(title.trim(), description.trim());
      toast.success('Quiz template created successfully!');
      
      // Update state and close dialog
      setQuizzes([newQuiz, ...quizzes]);
      setCreateDialogOpen(false);
      setTitle('');
      setDescription('');
      
      // Navigate straight to the editor
      router.push(`/dashboard/quizzes/${newQuiz.id}/edit`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create quiz.';
      toast.error(message);
    } finally {
      setActionLoading(false);
    }
  };

  // Clone Quiz Handler
  const handleCloneQuiz = async (quizId: string) => {
    const loadingToast = toast.loading('Cloning quiz...');
    try {
      const cloned = await cloneQuiz(quizId);
      toast.success('Quiz duplicated successfully!', { id: loadingToast });
      setQuizzes([cloned, ...quizzes]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to clone quiz.';
      toast.error(message, { id: loadingToast });
    }
  };

  // Delete Quiz Handler
  const handleDeleteQuiz = async (quizId: string) => {
    if (!confirm('Are you sure you want to delete this quiz? This will delete all its questions permanentely.')) {
      return;
    }
    const loadingToast = toast.loading('Deleting quiz...');
    try {
      await deleteQuiz(quizId);
      toast.success('Quiz deleted.', { id: loadingToast });
      setQuizzes(quizzes.filter((q) => q.id !== quizId));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete quiz.';
      toast.error(message, { id: loadingToast });
    }
  };

  // Host Game Handler (creates live lobby)
  const handleHostGame = async (quizId: string) => {
    const loadingToast = toast.loading('Creating live game room...');
    try {
      const session = await createGameSession(quizId);
      toast.success('Game lobby created! Redirecting...', { id: loadingToast });
      router.push(`/host/${session.id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start game.';
      toast.error(message, { id: loadingToast });
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-950 font-sans text-slate-100 flex flex-col justify-between">
      {/* Background Decorative Gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-violet-900/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-rose-900/10 blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="border-b border-slate-900 bg-slate-950/60 backdrop-blur-xl sticky top-0 z-20">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => router.push('/')}>
            <div className="bg-gradient-to-tr from-violet-600 to-fuchsia-600 p-2 rounded-xl flex items-center justify-center">
              <Flame className="w-5 h-5 text-white" />
            </div>
            <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-violet-400 via-fuchsia-400 to-rose-400 bg-clip-text text-transparent">
              QuizArena
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs text-slate-500 font-medium">Logged in as</span>
              <span className="text-sm font-semibold text-slate-300">{user.email}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 border border-slate-900 rounded-xl"
              onClick={handleLogout}
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="container mx-auto px-6 py-10 flex-1 z-10">
        {/* Title and Action bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-2">
              <Layers className="w-8 h-8 text-violet-500" /> Quiz Library
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Manage your reusable quiz templates and host interactive live rooms.
            </p>
          </div>
          <Button
            onClick={() => setCreateDialogOpen(true)}
            className="bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold h-11 px-5 rounded-xl shadow-lg shadow-violet-500/20 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Create New Quiz
          </Button>
        </div>

        {/* Quizzes Grid */}
        {quizzes.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 bg-slate-900/40 border border-slate-900 rounded-2xl text-center max-w-lg mx-auto mt-12">
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-2xl mb-4">
              <Layers className="w-12 h-12 text-slate-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-200">No quizzes created yet</h3>
            <p className="text-slate-500 text-sm mt-1 max-w-sm">
              Create your first customizable quiz to host live multiplayer rooms for your audience.
            </p>
            <Button
              onClick={() => setCreateDialogOpen(true)}
              className="mt-6 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl"
            >
              Get Started
            </Button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {quizzes.map((quiz) => {
              const questionCount = quiz.questions?.[0]?.count ?? 0;
              const accentColor = (typeof quiz.theme?.accentColor === 'string' ? quiz.theme.accentColor : null) || '#ec4899';
              
              return (
                <Card
                  key={quiz.id}
                  className="bg-slate-900/50 border-slate-900/80 hover:border-slate-800 hover:bg-slate-900/80 transition-all rounded-2xl overflow-hidden flex flex-col justify-between group shadow-xl"
                >
                  <CardHeader className="p-5 pb-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs px-2.5 py-0.5 rounded-full border border-violet-500/30 bg-violet-950/40 text-violet-300 font-semibold tracking-wide flex items-center gap-1">
                        {questionCount} {questionCount === 1 ? 'Question' : 'Questions'}
                      </span>
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-black/20"
                        style={{ backgroundColor: accentColor }}
                        title="Theme Accent Color"
                      />
                    </div>
                    <CardTitle className="text-xl font-bold text-white group-hover:text-violet-400 transition-colors line-clamp-1">
                      {quiz.title}
                    </CardTitle>
                    <CardDescription className="text-slate-400 text-xs line-clamp-2 mt-1 min-h-[2rem]">
                      {quiz.description || 'No description provided.'}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="p-5 pt-0 pb-3 flex flex-col gap-2 text-xs text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Created {new Date(quiz.created_at).toLocaleDateString()}</span>
                    </div>
                  </CardContent>

                  <CardFooter className="p-5 pt-3 border-t border-slate-950 bg-slate-900/30 flex items-center justify-between gap-2">
                    <Button
                      onClick={() => handleHostGame(quiz.id)}
                      className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-xl h-10 gap-1.5 shadow-md shadow-violet-500/10 text-xs"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" /> Host Live
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="border border-slate-800 hover:bg-slate-950 hover:text-white rounded-xl text-slate-400"
                      onClick={() => router.push(`/dashboard/quizzes/${quiz.id}/edit`)}
                      title="Edit Quiz & Questions"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="border border-slate-800 hover:bg-slate-950 hover:text-white rounded-xl text-slate-400"
                      onClick={() => handleCloneQuiz(quiz.id)}
                      title="Duplicate Quiz"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="border border-slate-800 hover:bg-rose-950/20 hover:text-rose-400 rounded-xl text-slate-400"
                      onClick={() => handleDeleteQuiz(quiz.id)}
                      title="Delete Quiz"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* Dialog for creating a new quiz */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 rounded-2xl max-w-md">
          <form onSubmit={handleCreateQuiz}>
            <DialogHeader>
              <DialogTitle className="text-xl font-bold text-white">Create New Quiz</DialogTitle>
              <DialogDescription className="text-slate-400 text-sm">
                Name your quiz template. You will customize themes and add questions next.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 my-6">
              <div className="space-y-2">
                <Label htmlFor="quizTitle" className="text-slate-300 text-xs font-semibold">
                  QUIZ TITLE
                </Label>
                <Input
                  id="quizTitle"
                  placeholder="e.g. World History Trivia"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="bg-slate-950 border-slate-800 h-11 focus-visible:ring-violet-500 rounded-xl"
                  maxLength={50}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quizDesc" className="text-slate-300 text-xs font-semibold">
                  DESCRIPTION (OPTIONAL)
                </Label>
                <Input
                  id="quizDesc"
                  placeholder="e.g. 10 questions on general history trivia"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="bg-slate-950 border-slate-800 h-11 focus-visible:ring-violet-500 rounded-xl"
                  maxLength={150}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateDialogOpen(false)}
                className="border border-slate-800 hover:bg-slate-950 text-slate-400 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={actionLoading}
                className="bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl"
              >
                {actionLoading ? 'Creating...' : 'Create & Edit'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Footer */}
      <footer className="container mx-auto px-6 py-6 border-t border-slate-900 text-slate-500 text-xs z-10 text-center">
        <div>&copy; {new Date().getFullYear()} QuizArena. All rights reserved.</div>
      </footer>
    </div>
  );
}
