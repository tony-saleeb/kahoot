'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { saveQuizData } from '@/app/actions/quizzes';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Upload,
  Settings2,
  FileSpreadsheet,
  CheckCircle,
  Clock,
  Award,
  Save,
} from 'lucide-react';

interface AnswerOption {
  id: string;
  text: string;
  is_correct: boolean;
  color: string;
  shape: 'triangle' | 'diamond' | 'circle' | 'square' | 'star' | 'hexagon';
}

interface Question {
  id?: string;
  type: 'mcq' | 'true_false' | 'multi_select' | 'type_answer' | 'poll';
  prompt: string;
  media_url: string | null;
  media_type: 'image' | 'video' | null;
  time_limit_seconds: number;
  points_base: number;
  scoring_type: 'linear' | 'flat' | 'none';
  answers: AnswerOption[];
}

interface QuizEditorClientProps {
  quiz: {
    id: string;
    title: string;
    description: string;
    theme: Record<string, unknown>;
    randomize_questions: boolean;
    randomize_answers: boolean;
    team_mode: boolean;
    double_points_rounds: string[]; // question indices or IDs
  };
  initialQuestions: Question[];
}

// Pre-defined shapes and colors à la Kahoot
const DEFAULT_ANSWERS: AnswerOption[] = [
  { id: '1', text: '', is_correct: false, color: '#e21b3c', shape: 'triangle' },
  { id: '2', text: '', is_correct: false, color: '#1368ce', shape: 'diamond' },
  { id: '3', text: '', is_correct: false, color: '#d89e00', shape: 'circle' },
  { id: '4', text: '', is_correct: false, color: '#26890c', shape: 'square' },
  { id: '5', text: '', is_correct: false, color: '#a855f7', shape: 'star' },
  { id: '6', text: '', is_correct: false, color: '#f97316', shape: 'hexagon' },
];

export default function QuizEditorClient({
  quiz,
  initialQuestions,
}: QuizEditorClientProps) {
  const router = useRouter();

  // Quiz Settings State
  const [title, setTitle] = useState(quiz.title);
  const [description, setDescription] = useState(quiz.description || '');
  const [randomizeQs, setRandomizeQs] = useState(quiz.randomize_questions);
  const [randomizeAs, setRandomizeAs] = useState(quiz.randomize_answers);
  const [teamMode, setTeamMode] = useState(quiz.team_mode);
  const [theme, setTheme] = useState(quiz.theme || {});
  const [doublePointsRounds, setDoublePointsRounds] = useState<string[]>(
    quiz.double_points_rounds || []
  );

  // Questions State
  const [questions, setQuestions] = useState<Question[]>(
    initialQuestions.length > 0
      ? initialQuestions
      : [createDefaultQuestion('mcq')]
  );
  const [activeIndex, setActiveIndex] = useState(0);

  // UI Dialog States
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [csvText, setCsvText] = useState('');

  // Helper to create a new default question template
  function createDefaultQuestion(
    type: 'mcq' | 'true_false' | 'multi_select' | 'type_answer' | 'poll'
  ): Question {
    let answers: AnswerOption[] = [];

    if (type === 'mcq' || type === 'multi_select' || type === 'poll') {
      answers = DEFAULT_ANSWERS.slice(0, 4).map((ans) => ({ ...ans }));
    } else if (type === 'true_false') {
      answers = [
        { id: '1', text: 'True', is_correct: false, color: '#e21b3c', shape: 'triangle' },
        { id: '2', text: 'False', is_correct: false, color: '#1368ce', shape: 'diamond' },
      ];
    } else if (type === 'type_answer') {
      // Type answer doesn't display choices. Players type input which is fuzzy checked.
      // We keep a single placeholder answer where correct text answer options are defined.
      answers = [
        { id: '1', text: '', is_correct: true, color: '#6366f1', shape: 'square' },
      ];
    }

    return {
      type,
      prompt: '',
      media_url: '',
      media_type: null,
      time_limit_seconds: 20,
      points_base: 1000,
      scoring_type: type === 'poll' ? 'none' : 'linear',
      answers,
    };
  }

  const activeQuestion = questions[activeIndex];

  // Update question type
  const handleTypeChange = (type: Question['type']) => {
    const updated = [...questions];
    const original = updated[activeIndex];
    
    // Create new blank default based on type
    const template = createDefaultQuestion(type);
    
    // Merge existing prompt & media settings to avoid losing progress
    template.prompt = original.prompt;
    template.media_url = original.media_url;
    template.media_type = original.media_type;
    template.time_limit_seconds = original.time_limit_seconds;
    template.points_base = original.points_base;

    // For polls, override scoring type to none
    if (type === 'poll') {
      template.scoring_type = 'none';
    } else if (original.type === 'poll') {
      template.scoring_type = 'linear';
    } else {
      template.scoring_type = original.scoring_type;
    }

    updated[activeIndex] = template;
    setQuestions(updated);
  };

  // Add question
  const addQuestion = (type: 'mcq' | 'true_false' | 'multi_select' | 'type_answer' | 'poll') => {
    const newQ = createDefaultQuestion(type);
    setQuestions([...questions, newQ]);
    setActiveIndex(questions.length);
    toast.success('Question added.');
  };

  // Duplicate question
  const duplicateQuestion = (idx: number) => {
    const qToCopy = questions[idx];
    const copy: Question = {
      ...qToCopy,
      id: undefined, // remove ID so it creates a new DB row on save
      answers: qToCopy.answers.map((ans) => ({ ...ans })),
    };
    const updated = [...questions];
    updated.splice(idx + 1, 0, copy);
    setQuestions(updated);
    setActiveIndex(idx + 1);
    toast.success('Question duplicated.');
  };

  // Delete question
  const removeQuestion = (idx: number) => {
    if (questions.length <= 1) {
      toast.error('Your quiz must contain at least one question.');
      return;
    }
    const updated = questions.filter((_, i) => i !== idx);
    setQuestions(updated);
    setActiveIndex(Math.max(0, idx - 1));
    toast.success('Question removed.');
  };

  // Shift question order
  const moveQuestion = (idx: number, direction: 'up' | 'down') => {
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === questions.length - 1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    const updated = [...questions];
    const temp = updated[idx];
    updated[idx] = updated[targetIdx];
    updated[targetIdx] = temp;

    setQuestions(updated);
    setActiveIndex(targetIdx);
  };

  // Edit active question fields
  const updateActiveQ = (fields: Partial<Question>) => {
    const updated = [...questions];
    updated[activeIndex] = { ...updated[activeIndex], ...fields };
    setQuestions(updated);
  };

  // Edit choices within active question
  const updateAnswerOption = (ansIdx: number, text: string) => {
    const updated = [...questions];
    const active = { ...updated[activeIndex] };
    active.answers = active.answers.map((ans, i) =>
      i === ansIdx ? { ...ans, text } : ans
    );
    updated[activeIndex] = active;
    setQuestions(updated);
  };

  // Update correct flags
  const toggleCorrectAnswer = (ansIdx: number) => {
    const updated = [...questions];
    const active = { ...updated[activeIndex] };

    if (active.type === 'mcq' || active.type === 'true_false') {
      // Single correct answer only
      active.answers = active.answers.map((ans, i) => ({
        ...ans,
        is_correct: i === ansIdx,
      }));
    } else if (active.type === 'multi_select') {
      // Multiple correct answers allowed
      active.answers = active.answers.map((ans, i) =>
        i === ansIdx ? { ...ans, is_correct: !ans.is_correct } : ans
      );
    }
    updated[activeIndex] = active;
    setQuestions(updated);
  };

  // Add more MCQ options (up to 6)
  const addAnswerOption = () => {
    if (activeQuestion.answers.length >= 6) {
      toast.error('Maximum of 6 options allowed.');
      return;
    }
    const count = activeQuestion.answers.length;
    const optTemplate = DEFAULT_ANSWERS[count];
    updateActiveQ({
      answers: [...activeQuestion.answers, { ...optTemplate, text: '' }],
    });
  };

  // Remove MCQ option (down to 2 minimum)
  const removeAnswerOption = (idx: number) => {
    if (activeQuestion.answers.length <= 2) {
      toast.error('Minimum of 2 options required.');
      return;
    }
    const updatedAnswers = activeQuestion.answers.filter((_, i) => i !== idx)
      // re-map pre-defined colors & shapes to keep theme consistent
      .map((ans, i) => ({
        ...ans,
        color: DEFAULT_ANSWERS[i].color,
        shape: DEFAULT_ANSWERS[i].shape,
      }));
    updateActiveQ({ answers: updatedAnswers });
  };

  // Double Points Round Toggle
  const isDoublePointsRound = doublePointsRounds.includes(activeIndex.toString());
  const toggleDoublePoints = () => {
    const roundStr = activeIndex.toString();
    if (doublePointsRounds.includes(roundStr)) {
      setDoublePointsRounds(doublePointsRounds.filter((r) => r !== roundStr));
    } else {
      setDoublePointsRounds([...doublePointsRounds, roundStr]);
    }
  };

  // Handle CSV File upload selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvText(text);
      toast.success(`Successfully loaded ${file.name}! Click "Import Questions" below to confirm.`);
    };
    reader.onerror = () => {
      toast.error('Failed to read the selected file.');
    };
    reader.readAsText(file);
  };

  // Client-Side CSV Parsing for imports
  const handleCSVImport = () => {
    if (!csvText.trim()) {
      toast.error('Please paste or upload some CSV data first.');
      return;
    }

    try {
      const lines = csvText.split('\n');
      const importedQs: Question[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // basic CSV parser handling double quotes
        const cells: string[] = [];
        let currentCell = '';
        let insideQuote = false;

        for (let charIdx = 0; charIdx < line.length; charIdx++) {
          const char = line[charIdx];
          if (char === '"') {
            insideQuote = !insideQuote;
          } else if (char === ',' && !insideQuote) {
            cells.push(currentCell.trim().replace(/^"|"$/g, ''));
            currentCell = '';
          } else {
            currentCell += char;
          }
        }
        cells.push(currentCell.trim().replace(/^"|"$/g, ''));

        // Skip CSV headers if match
        if (i === 0 && cells[0].toLowerCase().includes('prompt')) {
          continue;
        }

        if (cells.length < 5) {
          throw new Error(`Line ${i + 1} does not have enough columns. Minimum format: Prompt, Type, TimeLimit, Points, CorrectIndex/CorrectText, Choices...`);
        }

        const [prompt, typeInput, timeLimit, points, gradingField, ...choices] = cells;
        const type = (typeInput.trim().toLowerCase() as Question['type']) || 'mcq';
        const limitSec = parseInt(timeLimit) || 20;
        const basePts = parseInt(points) || 1000;

        let answers: AnswerOption[] = [];

        if (type === 'type_answer') {
          answers = [{ id: '1', text: gradingField, is_correct: true, color: '#6366f1', shape: 'square' }];
        } else if (type === 'true_false') {
          const correctVal = gradingField.trim().toLowerCase();
          const isTrueCorrect = correctVal === 'true' || correctVal === '1' || correctVal === 't';
          answers = [
            { id: '1', text: 'True', is_correct: isTrueCorrect, color: '#e21b3c', shape: 'triangle' },
            { id: '2', text: 'False', is_correct: !isTrueCorrect, color: '#1368ce', shape: 'diamond' },
          ];
        } else if (type === 'poll') {
          answers = choices.slice(0, 6).map((c, idx) => ({
            id: (idx + 1).toString(),
            text: c,
            is_correct: false,
            color: DEFAULT_ANSWERS[idx].color,
            shape: DEFAULT_ANSWERS[idx].shape,
          }));
        } else if (type === 'mcq' || type === 'multi_select') {
          // parse grading field: comma-separated index (1-based index)
          const correctIndices = gradingField.split(';').map((idx) => parseInt(idx.trim()) - 1);
          answers = choices.slice(0, 6).map((c, idx) => ({
            id: (idx + 1).toString(),
            text: c,
            is_correct: correctIndices.includes(idx),
            color: DEFAULT_ANSWERS[idx].color,
            shape: DEFAULT_ANSWERS[idx].shape,
          }));
        }

        importedQs.push({
          type,
          prompt,
          media_url: null,
          media_type: null,
          time_limit_seconds: limitSec,
          points_base: basePts,
          scoring_type: type === 'poll' ? 'none' : 'linear',
          answers,
        });
      }

      if (importedQs.length > 0) {
        setQuestions([...questions, ...importedQs]);
        setImportOpen(false);
        setCsvText('');
        toast.success(`Successfully imported ${importedQs.length} questions!`);
      }
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Failed to parse CSV. Please check formatting guidelines.';
      toast.error(message);
    }
  };

  // Batch Save Trigger
  const handleSaveQuiz = async () => {
    // Basic verification checks
    if (!title.trim()) {
      toast.error('Quiz title cannot be empty.');
      return;
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.prompt.trim()) {
        toast.error(`Question ${i + 1} has an empty prompt.`);
        setActiveIndex(i);
        return;
      }
      if (q.type !== 'poll') {
        const correctCount = q.answers.filter((a) => a.is_correct).length;
        if (correctCount === 0) {
          toast.error(`Question ${i + 1} must have at least one correct answer selected.`);
          setActiveIndex(i);
          return;
        }
      }
      if (q.type === 'mcq' || q.type === 'multi_select' || q.type === 'poll') {
        const emptyAns = q.answers.some((a) => !a.text.trim());
        if (emptyAns) {
          toast.error(`Question ${i + 1} has empty answer option fields.`);
          setActiveIndex(i);
          return;
        }
      }
    }

    setSaving(true);
    const loadingToast = toast.loading('Saving quiz data to server...');
    try {
      await saveQuizData(
        quiz.id,
        {
          title: title.trim(),
          description: description.trim(),
          theme,
          randomize_questions: randomizeQs,
          randomize_answers: randomizeAs,
          team_mode: teamMode,
          double_points_rounds: doublePointsRounds,
        },
        questions
      );
      toast.success('All changes saved successfully!', { id: loadingToast });
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save quiz.';
      toast.error(message, { id: loadingToast });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Editor Control Header */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="border border-slate-800 rounded-xl text-slate-400 hover:text-white"
            onClick={() => router.push('/dashboard')}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="font-extrabold text-white text-lg leading-tight line-clamp-1">
              Editing: {title}
            </h2>
            <p className="text-slate-500 text-xs mt-0.5">
              {questions.length} {questions.length === 1 ? 'Question' : 'Questions'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setImportOpen(true)}
            className="border border-slate-800 hover:bg-slate-900 rounded-xl flex items-center gap-1.5 text-xs text-slate-300"
          >
            <Upload className="w-3.5 h-3.5" /> Import
          </Button>
          <Button
            variant="ghost"
            onClick={() => setSettingsOpen(true)}
            className="border border-slate-800 hover:bg-slate-900 rounded-xl flex items-center gap-1.5 text-xs text-slate-300"
          >
            <Settings2 className="w-3.5 h-3.5" /> Quiz Settings
          </Button>
          <Button
            onClick={handleSaveQuiz}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center gap-1.5 h-10 px-5"
          >
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Quiz'}
          </Button>
        </div>
      </header>

      {/* Editor Body Grid */}
      <div className="flex-1 grid md:grid-cols-12 overflow-hidden">
        {/* Left Side: Question List Navigation */}
        <aside className="md:col-span-3 border-r border-slate-900 bg-slate-950/40 p-4 flex flex-col justify-between overflow-y-auto max-h-[calc(100vh-73px)]">
          <div className="space-y-3">
            <span className="text-xs text-slate-500 uppercase tracking-widest font-bold">
              Questions
            </span>

            <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
              {questions.map((q, idx) => {
                const isSelected = idx === activeIndex;
                const isDouble = doublePointsRounds.includes(idx.toString());

                return (
                  <div
                    key={idx}
                    onClick={() => setActiveIndex(idx)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start justify-between gap-3 group relative ${
                      isSelected
                        ? 'bg-violet-600/10 border-violet-500 text-white shadow-lg'
                        : 'bg-slate-900/40 border-slate-900 hover:border-slate-800 text-slate-400 hover:text-slate-300'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 w-full">
                      <span className="text-xs font-bold bg-slate-950 border border-slate-800 rounded w-5 h-5 flex items-center justify-center text-slate-400 shrink-0">
                        {idx + 1}
                      </span>
                      <div className="flex flex-col min-w-0 w-full gap-0.5">
                        <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
                          {q.type.replace('_', ' ')} {isDouble && '⭐ 2x'}
                        </span>
                        <p className="text-xs font-medium truncate">
                          {q.prompt || 'Untitled question prompt...'}
                        </p>
                      </div>
                    </div>

                    {/* Move and delete controls inside thumbnail hover */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0 absolute right-2 top-2 bg-slate-900/90 border border-slate-800 p-0.5 rounded-lg">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          moveQuestion(idx, 'up');
                        }}
                        disabled={idx === 0}
                        className="text-slate-500 hover:text-white disabled:opacity-20"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          moveQuestion(idx, 'down');
                        }}
                        disabled={idx === questions.length - 1}
                        className="text-slate-500 hover:text-white disabled:opacity-20"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateQuestion(idx);
                        }}
                        className="text-slate-500 hover:text-violet-400"
                        title="Duplicate Question"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeQuestion(idx);
                        }}
                        className="text-slate-500 hover:text-rose-400"
                        title="Delete Question"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Add Question Panel */}
          <div className="pt-4 border-t border-slate-900 space-y-2 mt-4 bg-slate-950/80 sticky bottom-0">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
              Add Question
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                variant="outline"
                className="h-8 text-[11px] rounded-lg border-slate-900 hover:bg-slate-900 justify-start px-2.5"
                onClick={() => addQuestion('mcq')}
              >
                <Plus className="w-3 h-3 mr-1 text-violet-500" /> MCQ
              </Button>
              <Button
                variant="outline"
                className="h-8 text-[11px] rounded-lg border-slate-900 hover:bg-slate-900 justify-start px-2.5"
                onClick={() => addQuestion('true_false')}
              >
                <Plus className="w-3 h-3 mr-1 text-sky-500" /> True/False
              </Button>
              <Button
                variant="outline"
                className="h-8 text-[11px] rounded-lg border-slate-900 hover:bg-slate-900 justify-start px-2.5"
                onClick={() => addQuestion('multi_select')}
              >
                <Plus className="w-3 h-3 mr-1 text-emerald-500" /> Multi-select
              </Button>
              <Button
                variant="outline"
                className="h-8 text-[11px] rounded-lg border-slate-900 hover:bg-slate-900 justify-start px-2.5"
                onClick={() => addQuestion('type_answer')}
              >
                <Plus className="w-3 h-3 mr-1 text-fuchsia-500" /> Type Answer
              </Button>
            </div>
            <Button
              variant="outline"
              className="w-full h-8 text-[11px] rounded-lg border-slate-900 hover:bg-slate-900 justify-center px-2.5 mt-1"
              onClick={() => addQuestion('poll')}
            >
              <Plus className="w-3 h-3 mr-1 text-yellow-500" /> Add Poll Question (No Score)
            </Button>
          </div>
        </aside>

        {/* Right Side: Active Question Workspace */}
        <main className="md:col-span-9 p-6 overflow-y-auto max-h-[calc(100vh-73px)] space-y-6">
          {/* Question Meta Row */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 bg-slate-900/40 p-4 border border-slate-900 rounded-2xl items-center">
            {/* Question Type */}
            <div className="space-y-1.5">
              <Label className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">
                Question Type
              </Label>
              <Select value={activeQuestion.type} onValueChange={(val) => { if (val) handleTypeChange(val); }}>
                <SelectTrigger className="bg-slate-950 border-slate-800 h-9 text-xs rounded-xl">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-100">
                  <SelectItem value="mcq">Multiple Choice</SelectItem>
                  <SelectItem value="true_false">True / False</SelectItem>
                  <SelectItem value="multi_select">Multi-Select</SelectItem>
                  <SelectItem value="type_answer">Type Answer</SelectItem>
                  <SelectItem value="poll">Poll (Opinion)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Time Limit */}
            <div className="space-y-1.5">
              <Label className="text-slate-500 text-[10px] uppercase font-bold tracking-wider flex items-center justify-between pr-2">
                <span>Time Limit</span>
                <span className="font-mono text-violet-400 font-bold">
                  {activeQuestion.time_limit_seconds}s
                </span>
              </Label>
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                <Slider
                  min={5}
                  max={120}
                  step={5}
                  value={[activeQuestion.time_limit_seconds]}
                  onValueChange={(vals) => {
                    const val = Array.isArray(vals) ? vals[0] : (typeof vals === 'number' ? vals : (vals as number[])[0]);
                    updateActiveQ({ time_limit_seconds: val });
                  }}
                  className="w-full cursor-pointer py-1"
                />
              </div>
            </div>

            {/* Points Value */}
            <div className="space-y-1.5">
              <Label className="text-slate-500 text-[10px] uppercase font-bold tracking-wider flex items-center justify-between pr-2">
                <span>Base Points</span>
                <span className="font-mono text-violet-400 font-bold">
                  {activeQuestion.points_base}
                </span>
              </Label>
              <div className="flex items-center gap-3">
                <Award className="w-4 h-4 text-slate-500 shrink-0" />
                <Slider
                  min={0}
                  max={2000}
                  step={100}
                  disabled={activeQuestion.type === 'poll'}
                  value={[activeQuestion.points_base]}
                  onValueChange={(vals) => {
                    const val = Array.isArray(vals) ? vals[0] : (typeof vals === 'number' ? vals : (vals as number[])[0]);
                    updateActiveQ({ points_base: val });
                  }}
                  className="w-full cursor-pointer py-1"
                />
              </div>
            </div>

            {/* Scoring Decay Type */}
            <div className="space-y-1.5">
              <Label className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">
                Scoring Curve
              </Label>
              <Select
                disabled={activeQuestion.type === 'poll'}
                value={activeQuestion.scoring_type}
                onValueChange={(val) => { if (val) updateActiveQ({ scoring_type: val as Question['scoring_type'] }); }}
              >
                <SelectTrigger className="bg-slate-950 border-slate-800 h-9 text-xs rounded-xl">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-100">
                  <SelectItem value="linear">Linear Decay (Speed Bonus)</SelectItem>
                  <SelectItem value="flat">Flat points (No Speed Bonus)</SelectItem>
                  <SelectItem value="none">No points round</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Prompt Entry Box */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-slate-400 text-xs font-semibold">
                Question Prompt
              </Label>
              <div className="flex items-center gap-4 text-xs font-semibold text-violet-400">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Switch
                    checked={isDoublePointsRound}
                    onCheckedChange={toggleDoublePoints}
                    className="data-[state=checked]:bg-violet-600 scale-75"
                  />
                  Double Points Round (2x)
                </label>
              </div>
            </div>
            <Textarea
              placeholder="Type your question prompt here..."
              value={activeQuestion.prompt}
              onChange={(e) => updateActiveQ({ prompt: e.target.value })}
              className="bg-slate-900/50 border-slate-900 h-24 text-base focus-visible:ring-violet-500 rounded-2xl p-4 font-semibold resize-none"
              maxLength={150}
            />
          </div>

          {/* Media attachment input */}
          <div className="space-y-2">
            <Label className="text-slate-400 text-xs font-semibold">
              Media Attachment (Optional Image/GIF/Video URL)
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder="https://example.com/media.jpg"
                value={activeQuestion.media_url || ''}
                onChange={(e) => {
                  const url = e.target.value;
                  const type = url.match(/\.(mp4|webm|ogg)$/i) ? 'video' : url ? 'image' : null;
                  updateActiveQ({ media_url: url || null, media_type: type });
                }}
                className="bg-slate-900/50 border-slate-900 h-10 focus-visible:ring-violet-500 rounded-xl flex-1"
              />
              {activeQuestion.media_url && (
                <Select
                  value={activeQuestion.media_type || 'image'}
                  onValueChange={(val) => { if (val) updateActiveQ({ media_type: val as Question['media_type'] }); }}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-900 w-28 h-10 text-xs rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-slate-100">
                    <SelectItem value="image">Image / GIF</SelectItem>
                    <SelectItem value="video">Short Video</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Answers Design Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-slate-400 text-xs font-semibold">
                Answer Options & Correct Key Configuration
              </Label>
              {(activeQuestion.type === 'mcq' ||
                activeQuestion.type === 'multi_select' ||
                activeQuestion.type === 'poll') && (
                <Button
                  variant="ghost"
                  onClick={addAnswerOption}
                  disabled={activeQuestion.answers.length >= 6}
                  className="text-xs hover:bg-slate-900 text-violet-400 hover:text-violet-300 font-bold border border-slate-900 rounded-xl h-8 px-3"
                >
                  + Add Option
                </Button>
              )}
            </div>

            {activeQuestion.type === 'type_answer' ? (
              // Type the Answer Workspace
              <div className="p-5 bg-slate-900/40 border border-slate-900 rounded-2xl space-y-3">
                <Label htmlFor="correctText" className="text-slate-300 text-xs font-bold">
                  Correct Text Options (Fuzzy-matched, case-insensitive)
                </Label>
                <p className="text-slate-500 text-xs leading-normal">
                  Type the exact expected word/words. Separate alternative acceptable answers with semicolons (e.g. <code>Washington; George Washington; George</code>).
                </p>
                <Input
                  id="correctText"
                  placeholder="e.g. Earth; the earth"
                  value={activeQuestion.answers[0]?.text || ''}
                  onChange={(e) => updateAnswerOption(0, e.target.value)}
                  className="bg-slate-950 border-slate-800 h-12 text-lg font-bold focus-visible:ring-violet-500 rounded-xl"
                />
              </div>
            ) : (
              // Multiple Choice, Multi-select, True/False Grid
              <div className="grid sm:grid-cols-2 gap-4">
                {activeQuestion.answers.map((ans, ansIdx) => {
                  const shapesMap: Record<string, string> = {
                    triangle: '▲',
                    diamond: '◆',
                    circle: '●',
                    square: '■',
                    star: '★',
                    hexagon: '⬢',
                  };

                  return (
                    <div
                      key={ans.id}
                      className="relative flex items-center gap-3 bg-slate-900/30 border border-slate-900 p-3.5 rounded-2xl hover:border-slate-800 transition-colors"
                    >
                      {/* Shape visual box matching color */}
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg font-black shrink-0 shadow-lg"
                        style={{ backgroundColor: ans.color }}
                      >
                        {shapesMap[ans.shape] || '■'}
                      </div>

                      {/* Text Input */}
                      <Input
                        placeholder={`Option ${ansIdx + 1}`}
                        value={ans.text}
                        onChange={(e) => updateAnswerOption(ansIdx, e.target.value)}
                        className="bg-transparent border-0 focus-visible:ring-0 focus-visible:border-0 h-10 text-sm font-semibold flex-1 px-1"
                        maxLength={60}
                        disabled={activeQuestion.type === 'true_false'}
                      />

                      {/* Right Actions: Correct checkbox / Delete option */}
                      <div className="flex items-center gap-3 shrink-0">
                        {activeQuestion.type !== 'poll' && (
                          <button
                            type="button"
                            onClick={() => toggleCorrectAnswer(ansIdx)}
                            className={`w-7 h-7 rounded-xl border flex items-center justify-center transition-all ${
                              ans.is_correct
                                ? 'bg-emerald-500 border-emerald-400 text-white shadow-md shadow-emerald-500/20'
                                : 'border-slate-800 hover:border-slate-700 bg-slate-950 text-transparent'
                            }`}
                            title="Mark as Correct answer"
                          >
                            <CheckCircle className="w-4 h-4 fill-current" />
                          </button>
                        )}

                        {(activeQuestion.type === 'mcq' ||
                          activeQuestion.type === 'multi_select' ||
                          activeQuestion.type === 'poll') &&
                          activeQuestion.answers.length > 2 && (
                            <button
                              type="button"
                              onClick={() => removeAnswerOption(ansIdx)}
                              className="text-slate-500 hover:text-rose-400 transition-colors"
                              title="Remove option"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* QUIZ SETTINGS DIALOG */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white">Quiz Template Settings</DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Configure parameters that control layout pacing and theme visuals.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 my-4">
            <div className="space-y-2">
              <Label htmlFor="settingsTitle" className="text-slate-300 text-xs font-semibold">
                QUIZ TITLE
              </Label>
              <Input
                id="settingsTitle"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="bg-slate-950 border-slate-800 h-10 focus-visible:ring-violet-500 rounded-xl"
                maxLength={50}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settingsDesc" className="text-slate-300 text-xs font-semibold">
                DESCRIPTION
              </Label>
              <Textarea
                id="settingsDesc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-slate-950 border-slate-800 h-20 focus-visible:ring-violet-500 rounded-xl resize-none"
                maxLength={150}
              />
            </div>

            {/* Custom Theme Color Settings */}
            {(() => {
              const themeBg = (theme.bgColor as string) || '#0f172a';
              const themeAccent = (theme.accentColor as string) || '#ec4899';
              return (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                      Bg Color
                    </Label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={themeBg}
                        onChange={(e) => setTheme({ ...theme, bgColor: e.target.value })}
                        className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0 outline-none"
                      />
                      <span className="font-mono text-xs text-slate-400">{themeBg}</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                      Accent Color
                    </Label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={themeAccent}
                        onChange={(e) => setTheme({ ...theme, accentColor: e.target.value })}
                        className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0 outline-none"
                      />
                      <span className="font-mono text-xs text-slate-400">{themeAccent}</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Settings Toggles */}
            <div className="space-y-3.5 pt-2 border-t border-slate-850">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold text-slate-200">Randomize Question Order</span>
                  <span className="text-[10px] text-slate-500">Shuffles questions each play session.</span>
                </div>
                <Switch
                  checked={randomizeQs}
                  onCheckedChange={setRandomizeQs}
                  className="data-[state=checked]:bg-violet-600"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold text-slate-200">Randomize Answer Order</span>
                  <span className="text-[10px] text-slate-500">Shuffles choices for players.</span>
                </div>
                <Switch
                  checked={randomizeAs}
                  onCheckedChange={setRandomizeAs}
                  className="data-[state=checked]:bg-violet-600"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold text-slate-200">Team Mode Activation</span>
                  <span className="text-[10px] text-slate-500">Players join and score as teams.</span>
                </div>
                <Switch
                  checked={teamMode}
                  onCheckedChange={setTeamMode}
                  className="data-[state=checked]:bg-violet-600"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => setSettingsOpen(false)}
              className="bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl w-full h-10"
            >
              Done Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV IMPORT DIALOG */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 rounded-2xl max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-500" /> Import Questions from CSV
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Upload formatted text questions in bulk.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 my-2">
            <div className="p-3 bg-slate-950/60 border border-slate-850 rounded-xl space-y-1 text-slate-400 text-[11px] leading-relaxed">
              <span className="font-bold text-slate-300 block mb-1">CSV Template Columns:</span>
              <code>Prompt, Type, TimeLimit, Points, CorrectKey, Choice1, Choice2, Choice3, Choice4</code>
              <ul className="list-disc list-inside space-y-0.5 mt-1 text-slate-500">
                <li><b>Type:</b> <code>mcq</code> | <code>true_false</code> | <code>multi_select</code> | <code>type_answer</code> | <code>poll</code></li>
                <li><b>CorrectKey:</b> MCQ/Poll: 1-based index (e.g. <code>1</code> or <code>1;3</code> for multi-select). True/False: <code>true</code> or <code>false</code>. TypeAnswer: exact text matching answers.</li>
                <li><b>Choices:</b> Choices separated by commas (supports up to 6).</li>
              </ul>
            </div>

            <div className="space-y-1.5">
              <Label className="text-slate-400 text-xs font-semibold flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5" /> Upload CSV File
              </Label>
              <Input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="bg-slate-950 border-slate-850 h-10 focus-visible:ring-violet-500 rounded-xl text-xs cursor-pointer text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-900 file:text-slate-350 hover:file:bg-slate-800"
              />
            </div>

            <div className="text-center text-slate-700 text-[10px] font-bold uppercase my-1">
              — OR —
            </div>

            <div className="space-y-1.5">
              <Label className="text-slate-400 text-xs font-semibold">Paste CSV Contents</Label>
              <Textarea
                placeholder={`"Who was the first president?","mcq",20,1000,"2","John Adams","George Washington","Thomas Jefferson","James Madison"`}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                className="bg-slate-950 border-slate-850 h-44 focus-visible:ring-violet-500 rounded-xl font-mono text-xs resize-none"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => {
                setImportOpen(false);
                setCsvText('');
              }}
              className="border border-slate-800 hover:bg-slate-950 text-slate-400 rounded-xl"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCSVImport}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Import Questions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
