'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CountUp } from '@/components/ui/count-up'
import {
  User,
  Mail,
  Briefcase,
  Target,
  Save,
  Camera,
  Sparkles,
  Layers,
  CircleCheckBig,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../../lib/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { getUserProfile, updateUserProfile } from '@/lib/apiClient';
/* lib/avatar pulls Supabase Storage in, and nothing on this page needs it
   until someone actually picks or removes a picture — which most visits
   never do. Imported on demand inside the two handlers instead, so the cost
   lands on the interaction rather than on the route. */
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field'
import { ConnectedAccounts } from '@/components/profile/ConnectedAccounts';
import { Spinner } from '@/components/ui/spinner';
import { ProfileSkeleton } from '@/components/profile/ProfileSkeleton';

const SENIORITY_LEVELS = ['Entry', 'Mid-Level', 'Senior', 'Staff', 'Principal', 'Executive'];

/* Was a second inline re-implementation of the same Radix Select that
   Settings also carried — see the note there. Both now compose
   components/ui/select, so the trigger, popover and focus ring are defined
   once for the whole product. */
function SeniorityField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" aria-label="Seniority">
        <span className="flex min-w-0 items-center gap-2">
          <Layers className="size-4 shrink-0 text-(--color-ink-faint)" aria-hidden="true" />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {SENIORITY_LEVELS.map((level) => (
          <SelectItem key={level} value={level}>
            {level}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
    roles: [] as string[],
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
      roles: dirty.has('roles') ? current.roles : (profile.target_roles ?? current.roles),
    }));
  }

  const [roleDraft, setRoleDraft] = useState('');

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
      const { AvatarError, pathFromPublicUrl, uploadAvatar } = await import('@/lib/avatar');
      if (!authUser) throw new AvatarError('Your session expired. Sign in again.');

      // Pass the previous path so the old object is removed — otherwise every
      // upload leaves an orphan in the bucket.
      const previousPath = avatarUrl ? pathFromPublicUrl(avatarUrl) : null;
      const { publicUrl, path } = await uploadAvatar(authUser.id, file, previousPath);
      await avatarMutation.mutateAsync({ avatar_url: publicUrl, avatar_path: path });
    } catch (err) {
      setAvatarError(err instanceof Error && err.name === 'AvatarError' ? err.message : 'Upload failed. Try again.');
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
      const { deleteAvatar, pathFromPublicUrl } = await import('@/lib/avatar');
      const path = pathFromPublicUrl(avatarUrl);
      if (path) await deleteAvatar(path);
      // Empty string, not undefined: the API treats omitted as "leave alone"
      // and empty as an explicit clear to NULL.
      const updated = await updateUserProfile({ avatar_url: '', avatar_path: '' });
      queryClient.setQueryData(['user', 'profile'], updated);
    } catch (err) {
      setAvatarError(err instanceof Error && err.name === 'AvatarError' ? err.message : 'Could not remove the photo.');
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
          // Only when edited. Sending it unchanged would be harmless, but
          // omitting it keeps the PATCH honest about what actually changed.
          ...(dirty.has('roles') ? { target_roles: form.roles } : {}),
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
      <PageHeader
        eyebrow="Account"
        eyebrowIcon={Sparkles}
        title="Profile"
        description="Manage your career profile and preferences."
      />

      {/* The header is static and correct before the request lands, so it
          stays put and only the data-backed panels below are stood in for —
          swapping the whole page would move the one thing already right. */}
      {profileQuery.isPending && <ProfileSkeleton />}
      {!profileQuery.isPending && (
      <>

      {/* Identity hero */}
      <div
       
       
       
        className="glass-card overflow-hidden panel-enter"
      >
        <div className="relative h-20 bg-linear-to-r from-(--color-accent)/25 via-(--color-accent-dim)/15 to-transparent">
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
                  /* A plain img, deliberately. This was next/image with
                     `unoptimized` set, which turns off resizing, format
                     negotiation and the placeholder — leaving only the ~9KB
                     client runtime and nothing it buys. The avatar is one
                     fixed 80px square from Supabase Storage; the parent is
                     relative and sized, so inset-0 gives the same fill with
                     no layout shift. */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={avatarUrl}
                    alt=""
                    width={80}
                    height={80}
                    className="absolute inset-0 size-full object-cover"
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
              <div className="text-base font-semibold text-(--color-ink) font-display">{fullName || 'Your Name'}</div>
              <div className="text-sm text-(--color-ink-faint)">{form.email}</div>
              <div className="mt-1 flex items-center gap-2">
                {avatarBusy && (
                  <span className="text-xs text-(--color-ink-faint)">Working…</span>
                )}
                {avatarUrl && !avatarBusy && (
                  <button
                    type="button"
                    onClick={() => void handleAvatarDelete()}
                    className="inline-flex items-center gap-1 text-xs font-medium text-(--color-danger) hover:underline"
                  >
                    <Trash2 className="size-3" />
                    Remove photo
                  </button>
                )}
                {avatarError && (
                  <span className="text-xs text-(--color-danger)">{avatarError}</span>
                )}
              </div>
            </div>
          </div>
          <div className="pb-1">
            <span className="eyebrow">
              <Sparkles className="w-3 h-3" />
              Professional Plan
            </span>
          </div>
        </div>

        <div className="px-6 pb-6">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-(--color-ink-dim) font-medium">Profile completeness</span>
            <span className="text-(--color-accent) font-semibold tabular-nums">
              <CountUp value={completeness} />%
            </span>
          </div>
          <div className="h-1.5 bg-(--color-canvas-line-soft) rounded-full overflow-hidden">
            <div
              className="h-full bg-linear-to-r from-(--color-accent) to-(--color-accent-lighter) rounded-full panel-enter"
             
             
              />
          </div>
        </div>
      </div>

      {/* Personal information */}
      <div
       
       
       
        className="glass-card p-6 space-y-5 panel-enter"
      >
        <h2 className="text-sm font-semibold text-(--color-ink)">Personal Information</h2>

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
      </div>

      {/* Connected accounts */}
      <div className="panel-enter">
        <ConnectedAccounts />
      </div>

      {/* Career details */}
      <div
       
       
       
        className="glass-card p-6 space-y-5 panel-enter"
      >
        <h2 className="text-sm font-semibold text-(--color-ink)">Career Details</h2>

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

        {/* The roles the job feed is actually built from.
            Distinct from "Target role" above, which is a single headline
            shown on the profile. This list drives what appears in Job Market,
            and until now it was writable only during onboarding — so whatever
            someone picked in their first ninety seconds decided their feed
            forever, with no way to change it as their interests moved. */}
        <Field label="Roles your job feed is built from" htmlFor="roleInput">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5" role="list">
              {form.roles.map((role) => (
                <span
                  key={role}
                  role="listitem"
                  className="inline-flex items-center gap-1.5 rounded-md bg-canvas px-2.5 py-1 text-[12px] text-ink field-ring-soft"
                >
                  {role}
                  <button
                    type="button"
                    aria-label={`Remove ${role}`}
                    onClick={() => { markDirty('roles'); setForm((f) => ({ ...f, roles: f.roles.filter((r) => r !== role) })); }}
                    className="text-ink-faint transition-colors hover:text-danger"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <Input
              id="roleInput"
              value={roleDraft}
              placeholder="Add a role and press Enter"
              onChange={(e) => setRoleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const next = roleDraft.trim();
                if (!next) return;
                // Case-insensitive, matching the backend's own dedupe — so the
                // UI cannot build a list the API will then reject.
                if (form.roles.some((r) => r.toLowerCase() === next.toLowerCase())) {
                  setRoleDraft('');
                  return;
                }
                markDirty('roles');
                setForm((f) => ({ ...f, roles: [...f.roles, next] }));
                setRoleDraft('');
              }}
              startAdornment={<Target />}
            />

            {/* Stated, not enforced by disabling save: the rule belongs to the
                API, and a message explains it where a greyed-out button would
                not. */}
            <p className="text-[11px] text-ink-faint">
              {form.roles.length < 3
                ? `Add ${3 - form.roles.length} more — the feed needs at least three to work from.`
                : `${form.roles.length} roles. Remove one to stop seeing it in Job Market.`}
            </p>
          </div>
        </Field>

        <Button onClick={handleSave} disabled={saving} aria-busy={saving || undefined}>
            {saving ? (
              <span key="saving" className="flex items-center gap-2 panel-enter">
                <Spinner className="text-on-accent" label="Saving" />
                Saving…
              </span>
            ) : saved ? (
              <span
                key="saved"
               
               
               
                className="flex items-center gap-2 panel-enter"
              >
                <CircleCheckBig className="w-4 h-4" />
                Saved!
              </span>
            ) : (
              <span
                key="save"
               
               
               
                className="flex items-center gap-2 panel-enter"
              >
                <Save className="w-4 h-4" />
                Save changes
              </span>
            )}
        </Button>
      </div>
      </>
      )}
    </div>
  );
}
