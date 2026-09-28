import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Briefcase,
  Camera,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Target,
  Upload,
  X,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { profileService } from '@/services/profileService'
import { resumeService } from '@/services/resumeService'
import {
  type ActivityItemSchema,
  MAX_TARGET_ROLES,
  MIN_TARGET_ROLES,
  type ProfileSchema,
  type ProfileUpdatePayload,
  type UserStatsSchema,
} from '@/types/profile'

const SENIORITY_OPTIONS = ['Entry Level', 'Mid Level', 'Senior', 'Staff', 'Lead', 'Principal', 'Executive']
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((value, i) => value === b[i])
}

function formatDate(value: string | null): string {
  if (!value) return 'Unknown date'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Unknown date'
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Every dimension the real Profile model actually has — Figma's mock
// "completeness" is a fixed 86% with no formula behind it; this is a real
// one, computed from the same fields this page lets you edit.
function completenessChecks(profile: ProfileSchema, hasAvatar: boolean) {
  return [
    { done: hasAvatar, hint: 'Add a profile photo' },
    { done: Boolean(profile.bio), hint: 'Add an About summary' },
    { done: Boolean(profile.current_title), hint: 'Add your current title' },
    { done: Boolean(profile.seniority), hint: 'Add your seniority level' },
    { done: Boolean(profile.primary_target_role), hint: 'Add a primary target role' },
    { done: profile.target_roles.length >= MIN_TARGET_ROLES, hint: `Add at least ${MIN_TARGET_ROLES} target roles` },
    { done: Boolean(profile.primary_resume_filename), hint: 'Upload a resume' },
  ]
}

export function ProfilePage() {
  const { user, session } = useAuth()

  const [profile, setProfile] = useState<ProfileSchema | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [stats, setStats] = useState<UserStatsSchema | null>(null)
  const [activity, setActivity] = useState<ActivityItemSchema[] | null>(null)
  const [activityError, setActivityError] = useState(false)
  const [skills, setSkills] = useState<string[] | null>(null)

  const [editing, setEditing] = useState(false)
  const [currentTitle, setCurrentTitle] = useState('')
  const [seniority, setSeniority] = useState('')
  const [primaryTargetRole, setPrimaryTargetRole] = useState('')
  const [bio, setBio] = useState('')
  const [targetRoles, setTargetRoles] = useState<string[]>([])
  const [roleInput, setRoleInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const loadProfile = async () => {
    setProfileLoading(true)
    setProfileError(null)
    try {
      const data = await profileService.getProfile()
      setProfile(data)
      setCurrentTitle(data.current_title ?? '')
      setSeniority(data.seniority ?? '')
      setPrimaryTargetRole(data.primary_target_role ?? '')
      setBio(data.bio ?? '')
      setTargetRoles(data.target_roles)
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to load your profile.')
    } finally {
      setProfileLoading(false)
    }
  }

  useEffect(() => {
    loadProfile()
    profileService.getStats().then(setStats).catch(() => undefined)
    profileService
      .getActivity()
      .then((res) => setActivity(res.items))
      .catch(() => setActivityError(true))
  }, [])

  // The user's own extracted resume keywords double as a real "Skills" list
  // — nothing on the Profile model stores a curated skills tag list, so this
  // is the only honest source for that slot in Figma's design.
  useEffect(() => {
    if (!profile?.primary_resume_analysis_id) {
      setSkills(null)
      return
    }
    resumeService
      .getBreakdown(profile.primary_resume_analysis_id)
      .then((b) => setSkills(b.matched_keywords.slice(0, 14)))
      .catch(() => setSkills(null))
  }, [profile?.primary_resume_analysis_id])

  const rolesChanged = useMemo(
    () => (profile ? !sameStringArray(targetRoles, profile.target_roles) : false),
    [profile, targetRoles]
  )
  const rolesValid = !rolesChanged || (targetRoles.length >= MIN_TARGET_ROLES && targetRoles.length <= MAX_TARGET_ROLES)

  const hasChanges = useMemo(() => {
    if (!profile) return false
    return (
      currentTitle !== (profile.current_title ?? '') ||
      seniority !== (profile.seniority ?? '') ||
      primaryTargetRole !== (profile.primary_target_role ?? '') ||
      bio !== (profile.bio ?? '') ||
      rolesChanged
    )
  }, [profile, currentTitle, seniority, primaryTargetRole, bio, rolesChanged])

  const addRole = () => {
    const trimmed = roleInput.trim()
    if (!trimmed) return
    if (targetRoles.some((r) => r.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('That role is already in your list.')
      return
    }
    if (targetRoles.length >= MAX_TARGET_ROLES) {
      toast.error(`You can track at most ${MAX_TARGET_ROLES} target roles.`)
      return
    }
    setTargetRoles([...targetRoles, trimmed])
    setRoleInput('')
  }

  const removeRole = (role: string) => setTargetRoles(targetRoles.filter((r) => r !== role))

  const cancelEditing = () => {
    if (!profile) return
    setCurrentTitle(profile.current_title ?? '')
    setSeniority(profile.seniority ?? '')
    setPrimaryTargetRole(profile.primary_target_role ?? '')
    setBio(profile.bio ?? '')
    setTargetRoles(profile.target_roles)
    setEditing(false)
  }

  const handleSave = async () => {
    if (!profile) return
    if (!hasChanges) {
      setEditing(false)
      return
    }
    if (!rolesValid) return

    const payload: ProfileUpdatePayload = {}
    if (currentTitle !== (profile.current_title ?? '')) payload.current_title = currentTitle
    if (seniority !== (profile.seniority ?? '')) payload.seniority = seniority
    if (primaryTargetRole !== (profile.primary_target_role ?? '')) payload.primary_target_role = primaryTargetRole
    if (bio !== (profile.bio ?? '')) payload.bio = bio
    if (rolesChanged) payload.target_roles = targetRoles

    setSaving(true)
    try {
      const updated = await profileService.updateProfile(payload)
      setProfile(updated)
      setCurrentTitle(updated.current_title ?? '')
      setSeniority(updated.seniority ?? '')
      setPrimaryTargetRole(updated.primary_target_role ?? '')
      setBio(updated.bio ?? '')
      setTargetRoles(updated.target_roles)
      setEditing(false)
      toast.success('Profile updated.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update profile.')
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !user) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.')
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error('Image must be under 5MB.')
      return
    }
    setAvatarUploading(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${user.id}/${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, cacheControl: '3600' })
      if (uploadError) throw uploadError
      const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path)
      const updated = await profileService.updateProfile({ avatar_url: publicUrlData.publicUrl, avatar_path: path })
      setProfile(updated)
      toast.success('Profile photo updated.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not upload your photo.')
    } finally {
      setAvatarUploading(false)
    }
  }

  const providers = session?.user.identities?.map((identity) => identity.provider) ?? []
  const memberSince = session?.user.created_at ? formatDate(session.user.created_at) : null
  const displayName = user?.fullName || 'Unnamed user'

  const checks = profile ? completenessChecks(profile, Boolean(profile.avatar_url)) : []
  const completeness = checks.length ? Math.round((checks.filter((c) => c.done).length / checks.length) * 100) : 0
  const nextHint = checks.find((c) => !c.done)?.hint

  if (profileLoading) {
    return (
      <div className="grid gap-[18px]">
        <Skeleton className="h-[130px] w-full rounded-xl" />
        <div className="grid gap-[14px] lg:grid-cols-[1.35fr_.65fr]">
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    )
  }

  if (profileError || !profile) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm font-medium text-foreground">{profileError || 'Failed to load your profile.'}</p>
          <Button variant="outline" size="sm" onClick={loadProfile}>
            Try again
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <div className="grid gap-[18px]">
      {/* Hero */}
      <Card className="grid grid-cols-1 items-center gap-4 p-[21px] sm:grid-cols-[72px_1fr_auto] sm:gap-4 lg:grid-cols-[72px_1fr_220px_auto] lg:gap-[16px]">
        <div className="relative h-[68px] w-[68px] justify-self-center sm:justify-self-start">
          <Avatar className="h-[68px] w-[68px] rounded-[18px]">
            <AvatarImage src={profile.avatar_url ?? user?.avatarUrl ?? undefined} alt={displayName} />
            <AvatarFallback className="rounded-[18px] bg-gradient-to-br from-[#fde2d9] to-[#f4a28e] font-heading text-[20px] font-extrabold text-[#9a3412]">
              {initials(displayName)}
            </AvatarFallback>
          </Avatar>
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={avatarUploading}
            aria-label="Change profile photo"
            className="absolute -bottom-1 -right-1 grid h-[25px] w-[25px] place-items-center rounded-full border-[3px] border-card bg-secondary text-primary"
          >
            {avatarUploading ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />}
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
        </div>

        <div className="min-w-0 text-center sm:text-left">
          <h2 className="truncate font-heading text-[21px] font-bold text-foreground">{displayName}</h2>
          {editing ? (
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <Input
                value={currentTitle}
                onChange={(e) => setCurrentTitle(e.target.value)}
                placeholder="Current title, e.g. Senior Product Designer"
                className="h-9 text-xs"
              />
              <Select value={seniority || undefined} onValueChange={setSeniority}>
                <SelectTrigger className="h-9 w-full text-xs sm:w-[160px]">
                  <SelectValue placeholder="Seniority" />
                </SelectTrigger>
                <SelectContent>
                  {SENIORITY_OPTIONS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {[profile.current_title, profile.seniority].filter(Boolean).join(' · ') || 'Add your current title'}
            </p>
          )}
          <p className="mt-1 flex items-center justify-center gap-1 text-[8px] text-muted-foreground sm:justify-start">
            <Mail size={11} /> {user?.email}
          </p>
        </div>

        <div className="hidden w-[220px] lg:block">
          <div className="flex justify-between text-[8px] text-muted-foreground">
            <span>Profile completeness</span>
            <strong className="text-foreground">{completeness}%</strong>
          </div>
          <div className="my-[7px] h-[6px] rounded-full bg-muted">
            <span className="block h-full rounded-full bg-success transition-[width]" style={{ width: `${completeness}%` }} />
          </div>
          <small className="text-[7px] text-muted-foreground">
            {nextHint ? `${nextHint} to reach 100%` : "You're all set!"}
          </small>
        </div>

        <Button
          variant={editing ? 'default' : 'outline'}
          onClick={editing ? handleSave : () => setEditing(true)}
          disabled={saving || (editing && !rolesValid)}
          className="justify-self-center gap-1.5 sm:justify-self-end"
        >
          {saving ? (
            <Loader2 size={15} className="animate-spin" />
          ) : editing ? (
            <Save size={15} />
          ) : (
            <Pencil size={15} />
          )}
          {editing ? 'Save changes' : 'Edit profile'}
        </Button>
        {editing && (
          <button
            type="button"
            onClick={cancelEditing}
            className="col-span-full justify-self-center text-[10px] text-muted-foreground hover:text-foreground sm:justify-self-end"
          >
            Cancel
          </button>
        )}
      </Card>

      <div className="grid items-start gap-3 lg:grid-cols-[1.35fr_.65fr]">
        <main className="grid gap-3">
          {/* About */}
          <Card className="p-[18px]">
            <div className="flex items-center justify-between border-b border-border pb-[11px]">
              <h3 className="font-heading text-sm font-bold text-foreground">About</h3>
              {!editing && (
                <Button variant="ghost" size="sm" className="h-auto gap-1 p-0 text-[11px] text-primary" onClick={() => setEditing(true)}>
                  <Pencil size={12} /> Edit
                </Button>
              )}
            </div>
            {editing ? (
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 2000))}
                placeholder="A short summary of your background and what you're looking for."
                className="mt-3.5 min-h-[100px] text-[11px]"
              />
            ) : (
              <p className="mt-3.5 text-[10px] leading-relaxed text-muted-foreground">
                {profile.bio || 'No summary yet — add one so recruiters know your story at a glance.'}
              </p>
            )}
          </Card>

          {/* Career snapshot — replaces Figma's Experience list, which has no
              backing data (no work-history table anywhere); these are the
              real fields the Profile model actually stores. */}
          <Card className="p-[18px]">
            <div className="flex items-center justify-between border-b border-border pb-[11px]">
              <h3 className="font-heading text-sm font-bold text-foreground">Career snapshot</h3>
              {!editing && (
                <Button variant="ghost" size="sm" className="h-auto gap-1 p-0 text-[11px] text-primary" onClick={() => setEditing(true)}>
                  <Pencil size={12} /> Edit
                </Button>
              )}
            </div>
            <div className="grid divide-y divide-border">
              <div className="grid grid-cols-[38px_1fr] items-center gap-2.5 py-[15px]">
                <span className="grid h-9 w-9 place-items-center rounded-[9px] bg-secondary text-primary">
                  <Briefcase size={17} />
                </span>
                <div className="min-w-0">
                  <small className="text-[7px] uppercase tracking-wide text-muted-foreground">Current title</small>
                  {editing ? (
                    <Input value={currentTitle} onChange={(e) => setCurrentTitle(e.target.value)} className="mt-1 h-8 text-xs" />
                  ) : (
                    <strong className="mt-0.5 block text-[10px] text-foreground">{profile.current_title || '—'}</strong>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-[38px_1fr] items-center gap-2.5 py-[15px]">
                <span className="grid h-9 w-9 place-items-center rounded-[9px] bg-secondary text-primary">
                  <Target size={17} />
                </span>
                <div className="min-w-0">
                  <small className="text-[7px] uppercase tracking-wide text-muted-foreground">Primary target role</small>
                  {editing ? (
                    <Input
                      value={primaryTargetRole}
                      onChange={(e) => setPrimaryTargetRole(e.target.value)}
                      placeholder="e.g. AI Engineer"
                      className="mt-1 h-8 text-xs"
                    />
                  ) : (
                    <strong className="mt-0.5 block text-[10px] text-foreground">{profile.primary_target_role || '—'}</strong>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Recent activity */}
          <Card className="p-[18px]">
            <div className="flex items-center justify-between border-b border-border pb-[11px]">
              <h3 className="font-heading text-sm font-bold text-foreground">Recent activity</h3>
            </div>
            <div className="mt-1">
              {activity === null && !activityError && (
                <div className="space-y-2 py-3">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              )}
              {activityError && <p className="py-3 text-[10px] text-destructive">Could not load recent activity.</p>}
              {activity && activity.length === 0 && (
                <p className="py-3 text-[10px] text-muted-foreground">
                  No activity yet.{' '}
                  <Link to="/resume/upload" className="font-bold text-primary hover:underline">
                    Analyze a resume
                  </Link>{' '}
                  or{' '}
                  <Link to="/interview/setup" className="font-bold text-primary hover:underline">
                    run a mock interview
                  </Link>
                  .
                </p>
              )}
              {activity && activity.length > 0 && (
                <div className="divide-y divide-border">
                  {activity.map((item) => (
                    <div key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-2 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                          {item.kind === 'resume' ? <FileText size={14} /> : <MessageSquare size={14} />}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-semibold text-foreground">
                            {item.title || (item.kind === 'resume' ? 'Resume scan' : 'Interview session')}
                          </p>
                          <p className="text-[8px] text-muted-foreground">{formatDate(item.created_at)}</p>
                        </div>
                      </div>
                      {item.score !== null && (
                        <Badge variant="outline" className="shrink-0 text-[9px]">
                          {item.score}%
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </main>

        <aside className="grid gap-3">
          {/* Skills — sourced from the primary resume's real extracted keywords */}
          <Card className="p-[18px]">
            <div className="flex items-center justify-between border-b border-border pb-[11px]">
              <h3 className="font-heading text-sm font-bold text-foreground">Skills</h3>
              {profile.primary_resume_filename && (
                <Button variant="ghost" size="sm" asChild className="h-auto gap-1 p-0 text-[11px] text-primary">
                  <Link to="/resume/results">Manage</Link>
                </Button>
              )}
            </div>
            <div className="mt-3.5 flex flex-wrap gap-1.5">
              {skills && skills.length > 0 ? (
                skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-secondary px-2 py-1 text-[8px] font-bold text-primary"
                  >
                    {skill}
                  </span>
                ))
              ) : (
                <p className="text-[9px] text-muted-foreground">
                  {profile.primary_resume_filename
                    ? "We couldn't pull skills from your latest scan."
                    : 'Upload a resume to surface your real skills here.'}
                </p>
              )}
            </div>
          </Card>

          {/* Job preferences — only Roles is real; Figma's location/salary/work
              style have no field anywhere on Profile. */}
          <Card className="p-[18px]">
            <div className="flex items-center justify-between border-b border-border pb-[11px]">
              <h3 className="font-heading text-sm font-bold text-foreground">Job preferences</h3>
              {!editing && (
                <Button variant="ghost" size="sm" className="h-auto gap-1 p-0 text-[11px] text-primary" onClick={() => setEditing(true)}>
                  <Pencil size={12} /> Edit
                </Button>
              )}
            </div>
            <div className="mt-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[7px] uppercase tracking-wide text-muted-foreground">Target roles</span>
                {editing && (
                  <span className={cn('text-[8px]', rolesValid ? 'text-muted-foreground' : 'text-destructive')}>
                    {targetRoles.length} (need {MIN_TARGET_ROLES}-{MAX_TARGET_ROLES})
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {targetRoles.length === 0 && !editing && <p className="text-[9px] text-muted-foreground">None set yet.</p>}
                {targetRoles.map((role) => (
                  <span
                    key={role}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-[8px] font-bold text-primary"
                  >
                    {role}
                    {editing && (
                      <button type="button" onClick={() => removeRole(role)} aria-label={`Remove ${role}`}>
                        <X size={10} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {editing && (
                <div className="mt-2 flex gap-1.5">
                  <Input
                    value={roleInput}
                    onChange={(e) => setRoleInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addRole()
                      }
                    }}
                    placeholder="Add a role"
                    className="h-8 flex-1 text-xs"
                  />
                  <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={addRole} aria-label="Add role">
                    <Plus size={14} />
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {/* Resume on file */}
          <Card className="p-[18px]">
            <div className="flex items-center justify-between border-b border-border pb-[11px]">
              <h3 className="font-heading text-sm font-bold text-foreground">Resume on file</h3>
            </div>
            <div className="mt-3.5">
              {profile.primary_resume_filename ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
                  <span className="flex min-w-0 items-center gap-2 text-[10px] font-semibold text-foreground">
                    <FileText size={14} className="shrink-0 text-primary" />
                    <span className="truncate">{profile.primary_resume_filename}</span>
                  </span>
                  <Button asChild variant="ghost" size="sm" className="h-auto shrink-0 p-0 text-[10px] text-primary">
                    <Link to="/resume/upload">Replace</Link>
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2.5 py-2 text-center">
                  <p className="text-[9px] text-muted-foreground">No resume on file yet.</p>
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <Link to="/resume/upload">
                      <Upload size={14} />
                      Upload resume
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {/* Connected accounts */}
          <Card className="p-[18px]">
            <div className="flex items-center justify-between border-b border-border pb-[11px]">
              <h3 className="font-heading text-sm font-bold text-foreground">Connected accounts</h3>
            </div>
            <div className="mt-1">
              {providers.length === 0 ? (
                <p className="py-3 text-[9px] text-muted-foreground">No linked sign-in providers found.</p>
              ) : (
                providers.map((provider) => (
                  <div key={provider} className="flex items-center justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
                    <span className="flex items-center gap-2 text-[10px] font-medium capitalize text-foreground">
                      {provider === 'email' ? <Mail size={14} className="text-muted-foreground" /> : <Sparkles size={14} className="text-muted-foreground" />}
                      {provider}
                      <ExternalLink size={10} className="text-muted-foreground" />
                    </span>
                    <Badge variant="success" className="gap-1 text-[9px]">
                      <CheckCircle2 size={11} /> Connected
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </Card>

          {stats && (
            <Card className="grid grid-cols-3 gap-2 p-[18px] text-center">
              <div>
                <p className="font-heading text-lg font-extrabold text-foreground">{stats.resumes_analyzed}</p>
                <p className="text-[8px] text-muted-foreground">Resumes analyzed</p>
              </div>
              <div>
                <p className="font-heading text-lg font-extrabold text-foreground">{stats.interview_sessions}</p>
                <p className="text-[8px] text-muted-foreground">Interview sessions</p>
              </div>
              <div>
                <p className="font-heading text-lg font-extrabold text-foreground">
                  {stats.latest_ats_score !== null ? `${stats.latest_ats_score}%` : '—'}
                </p>
                <p className="text-[8px] text-muted-foreground">Latest ATS score</p>
              </div>
            </Card>
          )}
        </aside>
      </div>
    </div>
  )
}
