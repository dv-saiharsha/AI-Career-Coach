'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../../lib/AuthContext';
import { getUserProfile, updateUserProfile } from '@/lib/apiClient';
import { AvatarError, deleteAvatar, pathFromPublicUrl, uploadAvatar } from '@/lib/avatar';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field'
import { ConnectedAccounts } from '@/components/profile/ConnectedAccounts';
import { Spinner } from '@/components/ui/spinner';

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
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    email: user?.email ?? '',
    role: 'Software Engineer',
    seniority: 'Senior',
    targetRole: 'Staff Engineer',
    bio: '',
  });
  // Tracks which fields the user has actually touched, so a server value
  // arriving after first paint doesn't overwrite something being typed.
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const profileQuery = useQuery({
    queryKey: ['user', 'profile'],
    queryFn: getUserProfile,
  });
  const profile = profileQuery.data;

  // Hydrate from the server without clobbering in-flight edits. Done during
  // render via a stored snapshot rather than in an effect: setting form state
  // from a query result in useEffect is the cascading-render pattern React 19
  // warns about, and it would also flash the defaults before the real values.
  const [hydratedFrom, setHydratedFrom] = useState<string | null>(null);
  const serverStamp = profile ? JSON.stringify(profile) : null;
  if (profile && serverStamp !== hydratedFrom) {
    setHydratedFrom(serverStamp);
    setForm((current) => ({
      ...current,
      role: dirty.has('role') ? current.role : (profile.current_title ?? current.role),
      seniority: dirty.has('seniority') ? current.seniority : (profile.seniority ?? current.seniority),
      // Falls back to the first onboarding target role when no explicit
      // primary has been set — the two are different fields, but the
      // onboarding list is a reasonable first guess for the profile display.
      targetRole: dirty.has('targetRole')
        ? current.targetRole
        : (profile.primary_target_role ?? profile.target_roles[0] ?? current.targetRole),
      bio: dirty.has('bio') ? current.bio : (profile.bio ?? current.bio),
    }));
  }

  const markDirty = useCallback((field: string) => {
    setDirty((current) => (current.has(field) ? current : new Set(current).add(field)));
  }, []);

  const avatarUrl = profile?.avatar_url ?? null;

  const avatarMutation = useMutation({
    mutationFn: async (patch: { avatar_url: string; avatar_path: string }) =>
      updateUserProfile(patch),
    onSuccess: (updated) => queryClient.setQueryData(['user', 'profile'], updated),
  });

  async function handleAvatarPick(file: File | null) {
    if (!file) return;
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const supabase = createClient();
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser) throw new AvatarError('Your session expired. Sign in again.');

      // Pass the previous path so the old object is removed — otherwise every
      // upload leaves an orphan in the bucket.
      const previousPath = avatarUrl ? pathFromPublicUrl(avatarUrl) : null;
      const { publicUrl, path } = await uploadAvatar(authUser.id, file, previousPath);
      await avatarMutation.mutateAsync({ avatar_url: publicUrl, avatar_path: path });
    } catch (err) {
      setAvatarError(err instanceof AvatarError ? err.message : 'Upload failed. Try again.');
    } finally {
      setAvatarBusy(false);
      // Clear the input so re-picking the same file still fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleAvatarDelete() {
    if (!avatarUrl) return;
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const path = pathFromPublicUrl(avatarUrl);
      if (path) await deleteAvatar(path);
      // Empty string, not undefined: the API treats omitted as "leave alone"
      // and empty as an explicit clear to NULL.
      const updated = await updateUserProfile({ avatar_url: '', avatar_path: '' });
      queryClient.setQueryData(['user', 'profile'], updated);
    } catch (err) {
      setAvatarError(err instanceof AvatarError ? err.message : 'Could not remove the photo.');
    } finally {
      setAvatarBusy(false);
    }
  }

  const fullName = `${form.firstName} ${form.lastName}`.trim();

  const completeness = useMemo(() => {
    const fields = [form.firstName, form.lastName, form.role, form.seniority, form.targetRole, form.bio];
    const filled = fields.filter((f) => f && f.trim().length > 0).length;
    return Math.round((filled / fields.length) * 100);
  }, [form]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Name lives on the Supabase auth user; career details live on
      // public.profiles behind FastAPI. Two stores, so two calls — run
      // together since neither depends on the other.
      const [, updated] = await Promise.all([
        updateProfile({ firstName: form.firstName.trim(), lastName: form.lastName.trim() }),
        updateUserProfile({
          bio: form.bio.trim(),
          current_title: form.role.trim(),
          seniority: form.seniority,
          // primary_target_role, never target_roles: that list is the 3-5 set
          // driving the job feed, and writing one value into it would delete
          // the user's onboarding choices.
          primary_target_role: form.targetRole.trim(),
        }),
      ]);
      queryClient.setQueryData(['user', 'profile'], updated);
      setDirty(new Set());
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
            style={{ background: 'radial-gradient(circle at 15% 60%, rgba(var(--glow-rgb),0.13), transparent 60%)' }}
          />
        </div>

        <div className="px-6 pb-6 -mt-10 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
          <div className="flex items-end gap-4">
            <div className="relative">
              {/* text-on-accent, not text-white: in dark mode the accent is
                  cream, so white here would be invisible. */}
              <div className="relative flex size-20 items-center justify-center overflow-hidden rounded-full bg-accent font-display text-2xl font-medium text-on-accent ring-4 ring-canvas-raise">
                {avatarUrl ? (
                  // next/image over <img>: the project lints against raw img,
                  // and the bucket URL is remote so it needs an explicit size.
                  <Image
                    src={avatarUrl}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  (form.firstName[0]?.toUpperCase() ?? 'U')
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => void handleAvatarPick(e.target.files?.[0] ?? null)}
              />
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={avatarUrl ? 'Change profile photo' : 'Upload profile photo'}
                disabled={avatarBusy}
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 size-8 bg-canvas-raise"
              >
                <Camera className="size-3.5" />
              </Button>
            </div>
            <div className="pb-1">
              <div className="text-base font-semibold text-[var(--color-ink)] font-display">{fullName || 'Your Name'}</div>
              <div className="text-sm text-[var(--color-ink-faint)]">{form.email}</div>
              <div className="mt-1 flex items-center gap-2">
                {avatarBusy && (
                  <span className="text-xs text-[var(--color-ink-faint)]">Working…</span>
                )}
                {avatarUrl && !avatarBusy && (
                  <button
                    type="button"
                    onClick={() => void handleAvatarDelete()}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-danger)] hover:underline"
                  >
                    <Trash2 className="size-3" />
                    Remove photo
                  </button>
                )}
                {avatarError && (
                  <span className="text-xs text-[var(--color-danger)]">{avatarError}</span>
                )}
              </div>
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

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName">
            <Input
              id="firstName"
              autoComplete="given-name"
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              startAdornment={<User />}
            />
          </Field>
          <Field label="Last name" htmlFor="lastName">
            <Input
              id="lastName"
              autoComplete="family-name"
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
              startAdornment={<User />}
            />
          </Field>
        </div>

        <Field label="Email" htmlFor="email" hint="Your sign-in address cannot be changed here.">
          <Input
            id="email"
            type="email"
            value={form.email}
            disabled
            startAdornment={<Mail />}
          />
        </Field>

        <Field label="Bio" htmlFor="bio">
          <Textarea
            id="bio"
            value={form.bio}
            onChange={(e) => { markDirty('bio'); setForm((f) => ({ ...f, bio: e.target.value })); }}
            placeholder="Tell us about your career goals…"
            rows={3}
            className="resize-none"
          />
        </Field>
      </motion.div>

      {/* Connected accounts */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <ConnectedAccounts />
      </motion.div>

      {/* Career details */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="glass-card p-6 space-y-5"
      >
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Career Details</h2>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Current role" htmlFor="role">
            <Input
              id="role"
              autoComplete="organization-title"
              value={form.role}
              onChange={(e) => { markDirty('role'); setForm((f) => ({ ...f, role: e.target.value })); }}
              startAdornment={<Briefcase />}
            />
          </Field>
          <Field label="Seniority" htmlFor="seniority">
            <SeniorityField
              value={form.seniority}
              onChange={(v) => { markDirty('seniority'); setForm((f) => ({ ...f, seniority: v })); }}
            />
          </Field>
        </div>

        <Field label="Target role" htmlFor="targetRole">
          <Input
            id="targetRole"
            value={form.targetRole}
            onChange={(e) => { markDirty('targetRole'); setForm((f) => ({ ...f, targetRole: e.target.value })); }}
            startAdornment={<Target />}
          />
        </Field>

        <Button onClick={handleSave} disabled={saving} aria-busy={saving || undefined}>
          <AnimatePresence mode="wait" initial={false}>
            {saving ? (
              <motion.span key="saving" className="flex items-center gap-2">
                <Spinner className="text-on-accent" label="Saving" />
                Saving…
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
        </Button>
      </motion.div>
    </div>
  );
}
