'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Select from '@radix-ui/react-select';
import CountUp from 'react-countup';
import {
  User,
  Mail,
  Briefcase,
  Target,
  Save,
  Camera,
  Sparkles,
  Layers,
  ChevronDown,
  Check,
  CircleCheckBig,
} from 'lucide-react';
import { useAuth } from '../../../lib/AuthContext';

const SENIORITY_LEVELS = ['Entry', 'Mid-Level', 'Senior', 'Staff', 'Principal', 'Executive'];

function SeniorityField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger className="relative w-full flex items-center gap-2 bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] rounded-xl pl-10 pr-3 py-2.5 text-sm text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] data-[state=open]:border-[var(--color-accent)] transition-colors">
        <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-ink-faint)] pointer-events-none" />
        <Select.Value className="flex-1 text-left" />
        <Select.Icon>
          <ChevronDown className="w-4 h-4 text-[var(--color-ink-faint)]" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={6}
          className="overflow-hidden bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] z-50 w-[var(--radix-select-trigger-width)]"
        >
          <Select.Viewport className="p-1">
            {SENIORITY_LEVELS.map((level) => (
              <Select.Item
                key={level}
                value={level}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-sm text-[var(--color-ink-dim)] data-[highlighted]:bg-[var(--color-accent)]/10 data-[highlighted]:text-[var(--color-ink)] outline-none cursor-pointer transition-colors"
              >
                <Select.ItemText>{level}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export default function ProfilePage() {
  const { user, updateProfile } = useAuth();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    email: user?.email ?? '',
    role: 'Software Engineer',
    seniority: 'Senior',
    targetRole: 'Staff Engineer',
    bio: '',
  });

  const fullName = `${form.firstName} ${form.lastName}`.trim();

  const completeness = useMemo(() => {
    const fields = [form.firstName, form.lastName, form.role, form.seniority, form.targetRole, form.bio];
    const filled = fields.filter((f) => f && f.trim().length > 0).length;
    return Math.round((filled / fields.length) * 100);
  }, [form]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Only first/last name are real, Supabase-backed fields today — role,
      // seniority, target role, and bio have no backend field to persist to yet.
      await updateProfile({ firstName: form.firstName.trim(), lastName: form.lastName.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <span className="section-eyebrow-violet mb-3 inline-flex">
          <Sparkles className="w-3 h-3" />
          Account
        </span>
        <h1 className="text-2xl sm:text-3xl font-display font-semibold text-[var(--color-ink)] mb-1">Profile</h1>
        <p className="text-sm text-[var(--color-ink-dim)]">Manage your career profile and preferences.</p>
      </motion.div>

      {/* Identity hero */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card overflow-hidden"
      >
        <div className="relative h-20 bg-gradient-to-r from-[var(--color-accent)]/25 via-[var(--color-accent-dim)]/15 to-transparent">
          <div
            className="absolute inset-0 opacity-70"
            style={{ background: 'radial-gradient(circle at 15% 60%, rgba(var(--color-accent-rgb),0.35), transparent 60%)' }}
          />
        </div>

        <div className="px-6 pb-6 -mt-10 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
          <div className="flex items-end gap-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-2xl font-display font-medium text-white ring-4 ring-[var(--color-canvas-raise)]">
                {form.firstName[0]?.toUpperCase() ?? 'U'}
              </div>
              <button className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] flex items-center justify-center text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:border-[var(--color-accent)]/40 transition-colors">
                <Camera className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="pb-1">
              <div className="text-base font-semibold text-[var(--color-ink)] font-display">{fullName || 'Your Name'}</div>
              <div className="text-sm text-[var(--color-ink-faint)]">{form.email}</div>
            </div>
          </div>
          <div className="pb-1">
            <span className="section-eyebrow-violet">
              <Sparkles className="w-3 h-3" />
              Professional Plan
            </span>
          </div>
        </div>

        <div className="px-6 pb-6">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-[var(--color-ink-dim)] font-medium">Profile completeness</span>
            <span className="text-[var(--color-accent)] font-semibold tabular-nums">
              <CountUp end={completeness} duration={1} />%
            </span>
          </div>
          <div className="h-1.5 bg-[var(--color-canvas-line-soft)] rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-lighter)] rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${completeness}%` }}
              transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
            />
          </div>
        </div>
      </motion.div>

      {/* Personal information */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="glass-card p-6 space-y-5"
      >
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Personal Information</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-2">First Name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-ink-faint)]" />
              <input
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                className="w-full bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] rounded-xl pl-10 pr-4 py-2.5 text-sm text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-2">Last Name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-ink-faint)]" />
              <input
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                className="w-full bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] rounded-xl pl-10 pr-4 py-2.5 text-sm text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-2">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-ink-faint)]" />
            <input
              value={form.email}
              disabled
              className="w-full bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] rounded-xl pl-10 pr-4 py-2.5 text-sm text-[var(--color-ink-faint)] cursor-not-allowed"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-2">Bio</label>
          <textarea
            value={form.bio}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            placeholder="Tell us about your career goals..."
            rows={3}
            className="w-full bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] rounded-xl px-4 py-2.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none focus:border-[var(--color-accent)] transition-colors resize-none"
          />
        </div>
      </motion.div>

      {/* Career details */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass-card p-6 space-y-5"
      >
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Career Details</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-2">Current Role</label>
            <div className="relative">
              <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-ink-faint)]" />
              <input
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="w-full bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] rounded-xl pl-10 pr-4 py-2.5 text-sm text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-2">Seniority</label>
            <SeniorityField value={form.seniority} onChange={(v) => setForm((f) => ({ ...f, seniority: v }))} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-2">Target Role</label>
          <div className="relative">
            <Target className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-ink-faint)]" />
            <input
              value={form.targetRole}
              onChange={(e) => setForm((f) => ({ ...f, targetRole: e.target.value }))}
              className="w-full bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] rounded-xl pl-10 pr-4 py-2.5 text-sm text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
            />
          </div>
        </div>

        <button onClick={handleSave} disabled={saving} className="btn-brand disabled:opacity-60 disabled:cursor-not-allowed">
          <AnimatePresence mode="wait" initial={false}>
            {saving ? (
              <motion.span key="saving" className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Saving...
              </motion.span>
            ) : saved ? (
              <motion.span
                key="saved"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="flex items-center gap-2"
              >
                <CircleCheckBig className="w-4 h-4" />
                Saved!
              </motion.span>
            ) : (
              <motion.span
                key="save"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                Save changes
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </motion.div>
    </div>
  );
}
