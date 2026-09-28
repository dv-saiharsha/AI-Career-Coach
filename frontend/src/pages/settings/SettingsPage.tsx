import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronRight,
  Download,
  FileJson,
  Laptop,
  Loader2,
  Moon,
  Sun,
  Trash2,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { PasswordField } from '@/components/shared/PasswordField'
import { getPasswordStrength } from '@/lib/passwordStrength'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/ThemeContext'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { profileService, downloadJson } from '@/services/profileService'
import { notificationsService } from '@/services/notificationsService'
import type { NotificationItem } from '@/types/notifications'

const CONFIRM_PHRASE = 'DELETE'

type SettingsTab = 'account' | 'notifications' | 'integrations' | 'billing' | 'privacy' | 'appearance'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'billing', label: 'Billing' },
  { id: 'privacy', label: 'Privacy & Data' },
  { id: 'appearance', label: 'Appearance' },
]

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.floor((Date.now() - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function splitName(full: string): [string, string] {
  const trimmed = full.trim()
  if (!trimmed) return ['', '']
  const [first, ...rest] = trimmed.split(/\s+/)
  return [first, rest.join(' ')]
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border p-[18px]">
        <h3 className="font-heading text-sm font-bold text-foreground">{title}</h3>
        <p className="mt-1 text-[9px] text-muted-foreground">{description}</p>
      </div>
      <div className="p-[18px]">{children}</div>
    </Card>
  )
}

function AccountSettings() {
  const { user } = useAuth()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [savingInfo, setSavingInfo] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    const [f, l] = splitName(user?.fullName ?? '')
    setFirstName(f)
    setLastName(l)
    setEmail(user?.email ?? '')
  }, [user])

  const infoChanged = user ? `${firstName} ${lastName}`.trim() !== user.fullName || email.trim() !== user.email : false

  const saveInfo = async () => {
    if (!firstName.trim()) {
      toast.error('First name is required.')
      return
    }
    if (!email.trim()) {
      toast.error('Email is required.')
      return
    }
    const emailChanged = email.trim() !== user?.email
    setSavingInfo(true)
    try {
      const { error } = await supabase.auth.updateUser({
        ...(emailChanged ? { email: email.trim() } : {}),
        data: { full_name: `${firstName.trim()} ${lastName.trim()}`.trim() },
      })
      if (error) throw error
      toast.success(emailChanged ? 'Saved — check your inbox to confirm the new email address.' : 'Account information saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save your changes.')
    } finally {
      setSavingInfo(false)
    }
  }

  const passwordStrength = getPasswordStrength(newPassword)
  const canUpdatePassword = newPassword.length >= 8 && newPassword === confirmPassword

  const updatePassword = async () => {
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match.')
      return
    }
    setSavingPassword(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      toast.success('Password updated.')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update your password.')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="grid gap-3">
      <SettingsSection title="Personal information" description="Update your name and primary contact information.">
        <div className="grid grid-cols-1 gap-[13px] sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="email">Email address</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <Button className="mt-[15px] gap-2" onClick={saveInfo} disabled={!infoChanged || savingInfo}>
          {savingInfo && <Loader2 className="h-4 w-4 animate-spin" />}
          Save changes
        </Button>
      </SettingsSection>

      <SettingsSection title="Password" description="Choose a strong password you don't use elsewhere.">
        <div className="grid grid-cols-1 gap-[13px] sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <PasswordField id="newPassword" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            {newPassword && <p className="text-[10px] text-muted-foreground">{passwordStrength.label}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <PasswordField id="confirmPassword" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            {confirmPassword && confirmPassword !== newPassword && (
              <p className="text-[10px] text-destructive">Passwords don't match.</p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          className="mt-[15px] gap-2"
          onClick={updatePassword}
          disabled={!canUpdatePassword || savingPassword}
        >
          {savingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
          Update password
        </Button>
      </SettingsSection>
    </div>
  )
}

const NOTIFICATION_ROWS = [
  { key: 'application_updates', label: 'Application updates', detail: 'Status changes, reminders, and follow-ups' },
  { key: 'job_matches', label: 'Job matches', detail: 'New high-fit roles and expiring opportunities' },
  { key: 'interview_reminders', label: 'Interview reminders', detail: 'Upcoming sessions and practice prompts' },
  { key: 'weekly_progress', label: 'Weekly progress', detail: 'Readiness recap and recommended next steps' },
  { key: 'product_updates', label: 'Product updates', detail: 'New HireLoom tools and improvements' },
] as const

type NotificationPrefKey = (typeof NOTIFICATION_ROWS)[number]['key']
interface NotificationChannelPrefs {
  email: boolean
  inApp: boolean
}
type NotificationPrefs = Record<NotificationPrefKey, NotificationChannelPrefs>

const NOTIFICATION_PREFS_STORAGE_KEY = 'hireloom-notification-preferences'

function defaultNotificationPrefs(): NotificationPrefs {
  return Object.fromEntries(NOTIFICATION_ROWS.map((row) => [row.key, { email: true, inApp: true }])) as NotificationPrefs
}

function loadNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(NOTIFICATION_PREFS_STORAGE_KEY)
    if (!raw) return defaultNotificationPrefs()
    return { ...defaultNotificationPrefs(), ...JSON.parse(raw) }
  } catch {
    return defaultNotificationPrefs()
  }
}

// No per-category email/in-app delivery preference exists anywhere on the
// backend (confirmed directly against the models) — the real notification
// engine sends every event type to every user the same way. These toggles
// are real and persist (device-local, like the Offer Comparison page's own
// growth/team/flexibility ratings), just not yet wired to anything that
// changes what actually gets sent.
function NotificationPreferences() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => loadNotificationPrefs())

  const toggle = (key: NotificationPrefKey, channel: keyof NotificationChannelPrefs) => {
    setPrefs((prev) => {
      const next: NotificationPrefs = { ...prev, [key]: { ...prev[key], [channel]: !prev[key][channel] } }
      try {
        localStorage.setItem(NOTIFICATION_PREFS_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Best-effort only — a failed write just means the toggle resets
        // next visit, same as any other device-local preference here.
      }
      return next
    })
  }

  return (
    <SettingsSection title="Notification preferences" description="Choose how and when HireLoom keeps you informed.">
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[1fr_70px_70px] items-center gap-2 bg-muted/40 px-4 py-2 text-[7px] font-extrabold uppercase tracking-wide text-muted-foreground">
          <span>Notification</span>
          <span className="text-center">Email</span>
          <span className="text-center">In-app</span>
        </div>
        {NOTIFICATION_ROWS.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-[1fr_70px_70px] items-center gap-2 border-t border-border px-4 py-3"
          >
            <div className="min-w-0">
              <strong className="block text-[10px] text-foreground">{row.label}</strong>
              <small className="mt-0.5 block text-[8px] text-muted-foreground">{row.detail}</small>
            </div>
            <div className="flex justify-center">
              <Switch
                checked={prefs[row.key].email}
                onCheckedChange={() => toggle(row.key, 'email')}
                aria-label={`${row.label} — email`}
              />
            </div>
            <div className="flex justify-center">
              <Switch
                checked={prefs[row.key].inApp}
                onCheckedChange={() => toggle(row.key, 'inApp')}
                aria-label={`${row.label} — in-app`}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-[8px] italic text-muted-foreground">
        Saved on this device. HireLoom doesn't have per-category delivery rules server-side yet, so these don't
        change which real-time alerts (the bell above) actually arrive.
      </p>
    </SettingsSection>
  )
}

function NotificationActivity() {
  const [items, setItems] = useState<NotificationItem[] | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = (includeArchived: boolean) => {
    notificationsService
      .list(includeArchived)
      .then((res) => setItems(res.notifications))
      .catch(() => setItems([]))
  }

  useEffect(() => {
    load(showArchived)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived])

  const markAllRead = async () => {
    await notificationsService.markAllRead()
    load(showArchived)
  }

  const archiveOne = async (id: number) => {
    setBusyId(id)
    try {
      await notificationsService.archive(id)
      load(showArchived)
    } catch {
      toast.error('Could not archive that notification.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <SettingsSection
      title="Notification history"
      description="Real alerts HireLoom has actually sent you, independent of the preferences above."
    >
      <div className="flex items-center justify-between pb-3">
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Show archived
        </label>
        <Button variant="ghost" size="sm" className="h-auto p-0 text-[10px] text-primary" onClick={markAllRead}>
          Mark all read
        </Button>
      </div>
      {items === null && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {items && items.length === 0 && (
        <p className="py-6 text-center text-[10px] text-muted-foreground">
          {showArchived ? 'Nothing archived.' : "You're all caught up."}
        </p>
      )}
      {items?.map((item) => (
        <div key={item.id} className="grid grid-cols-[7px_1fr_auto] items-start gap-2.5 border-t border-border py-2.5 first:border-t-0">
          <span className={cn('mt-1.5 h-1.5 w-1.5 rounded-full', !item.read_at ? 'bg-coral' : 'bg-transparent')} />
          <div className="min-w-0">
            <strong className="block text-[10px] text-foreground">{item.title}</strong>
            <p className="mt-0.5 text-[9px] text-muted-foreground">{item.message}</p>
            <small className="mt-0.5 block text-[8px] text-muted-foreground">
              {relativeTime(item.created_at)} · {item.category.replace(/_/g, ' ')}
            </small>
          </div>
          {!item.archived_at && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground"
              disabled={busyId === item.id}
              onClick={() => archiveOne(item.id)}
              aria-label="Archive notification"
            >
              {busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      ))}
    </SettingsSection>
  )
}

function NotificationsSettings() {
  return (
    <div className="grid gap-3">
      <NotificationPreferences />
      <NotificationActivity />
    </div>
  )
}

function IntegrationsSettings() {
  const { session } = useAuth()
  const providers = session?.user.identities?.map((identity) => identity.provider) ?? []
  const googleConnected = providers.includes('google')

  return (
    <SettingsSection title="Connected accounts" description="Services linked to your HireLoom sign-in.">
      <div className="grid">
        <div className="grid grid-cols-[36px_1fr_auto] items-center gap-2.5 border-b border-border py-3">
          <span className="grid h-9 w-9 place-items-center rounded-[9px] border border-border text-[13px] font-extrabold">G</span>
          <div>
            <strong className="text-[10px] text-foreground">Google</strong>
            <p className="mt-0.5 text-[8px] text-muted-foreground">Sign-in and document access</p>
          </div>
          <span className={cn('text-[9px] font-semibold', googleConnected ? 'text-success' : 'text-muted-foreground')}>
            {googleConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        {[
          { name: 'LinkedIn', detail: 'Profile and professional network' },
          { name: 'Google Calendar', detail: 'Interview dates and reminders' },
        ].map((integration) => (
          <div key={integration.name} className="grid grid-cols-[36px_1fr_auto] items-center gap-2.5 border-b border-border py-3 last:border-b-0">
            <span className="grid h-9 w-9 place-items-center rounded-[9px] border border-border text-[10px] font-extrabold text-muted-foreground">
              {integration.name.slice(0, 2)}
            </span>
            <div>
              <strong className="text-[10px] text-foreground">{integration.name}</strong>
              <p className="mt-0.5 text-[8px] text-muted-foreground">{integration.detail}</p>
            </div>
            <span className="text-[9px] text-muted-foreground">Coming soon</span>
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}

// Illustrative content, not real account state — there is no
// subscription/billing system anywhere in the backend (confirmed directly
// against the models: no plan_tier, no invoice table, no usage-quota
// tracking). Ported verbatim from figma-export's own mock
// (`settingsData.plans` / `.invoices`) at your direct request to match the
// Figma Make preview exactly, including the "Pro · Current plan" framing,
// the per-plan feature lists, the usage bars, and the paid invoice history.
// Most buttons here are the same toast-only interaction figma-export's own
// source uses — nothing is wired to a real plan change or file download.
// "Choose Pro"/"Choose Premium" are the one exception: they go to the real
// (still fully fabricated, no real charge) /checkout page, same as the
// landing page's pricing section — see MIGRATION_PLAN.md's Landing Page
// section for that flow, and its Backend TODO for what real billing
// would need.
const BILLING_PLANS = [
  {
    name: 'Free',
    price: '$0',
    detail: 'Get started with the essentials',
    features: ['3 resume analyses', '2 practice sessions', 'Basic job matches'],
    current: false,
  },
  {
    name: 'Pro',
    price: '$19',
    detail: 'Build momentum with unlimited prep',
    features: ['Unlimited analyses', '10 AI sessions monthly', 'Tailored cover letters'],
    current: true,
  },
  {
    name: 'Premium',
    price: '$39',
    detail: 'End-to-end support through offer',
    features: ['Unlimited AI coaching', 'Offer negotiation', 'Priority job matches'],
    current: false,
  },
] as const

const BILLING_USAGE = [
  { label: 'AI interview sessions', used: 6, total: 10 },
  { label: 'Job applications', used: 12, total: 25 },
  { label: 'Document storage', used: 34, total: 100 },
] as const

const BILLING_INVOICES = [
  { date: 'Mar 1, 2026', amount: '$19.00', status: 'Paid' },
  { date: 'Feb 1, 2026', amount: '$19.00', status: 'Paid' },
  { date: 'Jan 1, 2026', amount: '$19.00', status: 'Paid' },
] as const

function BillingSettings() {
  const navigate = useNavigate()
  return (
    <div className="grid gap-3">
      <SettingsSection title="Choose your plan" description="Upgrade or change your plan at any time.">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {BILLING_PLANS.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                'relative flex flex-col rounded-[10px] border p-[15px]',
                plan.current ? 'border-primary shadow-[0_0_0_1px_theme(colors.primary.DEFAULT)]' : 'border-border'
              )}
            >
              {plan.current && (
                <span className="absolute right-[9px] top-[9px] text-[7px] font-extrabold text-primary">CURRENT PLAN</span>
              )}
              <h3 className="font-heading text-[13px] font-bold text-foreground">{plan.name}</h3>
              <strong className="mt-2 block font-heading text-xl font-extrabold text-foreground">
                {plan.price}
                <small className="text-[8px] font-normal text-muted-foreground">/month</small>
              </strong>
              <p className="mt-1 min-h-[25px] text-[8px] text-muted-foreground">{plan.detail}</p>
              <ul className="mt-1 grid min-h-[75px] gap-1.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-1.5 text-[8.5px] text-foreground/80">
                    <Check size={11} className="shrink-0 text-success" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                variant={plan.current ? 'outline' : 'default'}
                className="mt-2 w-full"
                onClick={() => {
                  if (plan.current) {
                    toast.success("You're already on Pro")
                    return
                  }
                  if (plan.name === 'Free') {
                    toast.success('Free selected')
                    return
                  }
                  navigate(`/checkout?plan=${plan.name.toLowerCase()}&billing=yearly`)
                }}
              >
                {plan.current ? 'Manage plan' : `Choose ${plan.name}`}
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-[18px] grid grid-cols-1 gap-3 sm:grid-cols-3">
          {BILLING_USAGE.map((usage) => (
            <div key={usage.label}>
              <div className="flex justify-between text-[9px]">
                <strong className="font-bold text-foreground">{usage.label}</strong>
                <small className="text-muted-foreground">
                  {usage.used} of {usage.total}
                </small>
              </div>
              <div className="mt-1.5 h-[5px] rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${(usage.used / usage.total) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Billing history" description="Download receipts for past payments.">
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[1fr_1fr_1fr_80px] items-center gap-2 bg-muted/40 px-4 py-2 text-[7px] font-extrabold uppercase tracking-wide text-muted-foreground">
            <span>Date</span>
            <span>Amount</span>
            <span>Status</span>
            <span />
          </div>
          {BILLING_INVOICES.map((invoice) => (
            <div
              key={invoice.date}
              className="grid grid-cols-[1fr_1fr_1fr_80px] items-center gap-2 border-t border-border px-4 py-3 text-[9px]"
            >
              <span className="text-foreground">{invoice.date}</span>
              <strong className="text-foreground">{invoice.amount}</strong>
              <span className="text-success">{invoice.status}</span>
              <Button variant="ghost" size="sm" className="h-auto justify-self-end gap-1 p-0 text-[10px]">
                <Download size={13} /> PDF
              </Button>
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  )
}

const PRIVACY_ROWS = [
  {
    key: 'personalized_recommendations',
    label: 'Personalized recommendations',
    detail: 'Use activity to improve job and coaching suggestions.',
  },
  {
    key: 'product_analytics',
    label: 'Product analytics',
    detail: 'Share anonymous usage data to improve HireLoom.',
  },
] as const

type PrivacyPrefKey = (typeof PRIVACY_ROWS)[number]['key']
type PrivacyPrefs = Record<PrivacyPrefKey, boolean>

const PRIVACY_PREFS_STORAGE_KEY = 'hireloom-privacy-preferences'

function defaultPrivacyPrefs(): PrivacyPrefs {
  return Object.fromEntries(PRIVACY_ROWS.map((row) => [row.key, true])) as PrivacyPrefs
}

function loadPrivacyPrefs(): PrivacyPrefs {
  try {
    const raw = localStorage.getItem(PRIVACY_PREFS_STORAGE_KEY)
    if (!raw) return defaultPrivacyPrefs()
    return { ...defaultPrivacyPrefs(), ...JSON.parse(raw) }
  } catch {
    return defaultPrivacyPrefs()
  }
}

// Same honest pattern as the Notifications tab's preference matrix: no
// field for either of these exists on Profile or anywhere else server-side
// (confirmed directly against the models), so these are real, persisted
// (device-local) toggles rather than server-synced settings — not fabricated
// switches that silently do nothing when flipped.
function PrivacyControls() {
  const [prefs, setPrefs] = useState<PrivacyPrefs>(() => loadPrivacyPrefs())

  const toggle = (key: PrivacyPrefKey) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        localStorage.setItem(PRIVACY_PREFS_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Best-effort only.
      }
      return next
    })
  }

  return (
    <SettingsSection title="Privacy controls" description="Control how your information is used.">
      <div>
        {PRIVACY_ROWS.map((row) => (
          <div
            key={row.key}
            className="flex items-center justify-between gap-3 border-t border-border py-3 first:border-t-0"
          >
            <div className="min-w-0">
              <strong className="block text-[10px] text-foreground">{row.label}</strong>
              <small className="mt-0.5 block text-[8px] text-muted-foreground">{row.detail}</small>
            </div>
            <Switch
              checked={prefs[row.key]}
              onCheckedChange={() => toggle(row.key)}
              aria-label={row.label}
              className="shrink-0"
            />
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-[8px] italic text-muted-foreground">
        Saved on this device — HireLoom doesn't have account-level personalization/analytics-sharing flags
        server-side yet.
      </p>
    </SettingsSection>
  )
}

function PrivacySettings() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [exporting, setExporting] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deletePartial, setDeletePartial] = useState(false)

  const armed = confirmText.trim() === CONFIRM_PHRASE

  const handleExport = async () => {
    setExporting(true)
    try {
      const data = await profileService.exportData()
      const stamp = new Date().toISOString().slice(0, 10)
      downloadJson(data, `hireloom-data-export-${stamp}.json`)
      toast.success('Your data is downloading.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not build your export.')
    } finally {
      setExporting(false)
    }
  }

  const handleDelete = async () => {
    if (!armed) return
    setDeleting(true)
    try {
      const result = await profileService.deleteAccount()
      if (!result.sign_in_disabled) {
        setDeletePartial(true)
        return
      }
      await logout()
      navigate('/login')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete your account. Nothing was removed.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="grid gap-3">
      <SettingsSection
        title="Export your data"
        description="Download a copy of your profile, documents, and activity."
      >
        <div className="grid grid-cols-[38px_1fr_auto] items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[9px] bg-secondary text-primary">
            <FileJson size={18} />
          </span>
          <div>
            <strong className="text-[10px] text-foreground">HireLoom data export</strong>
            <p className="mt-0.5 text-[9px] text-muted-foreground">A JSON file of everything HireLoom holds about your account.</p>
          </div>
          <Button size="sm" className="gap-2" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? 'Preparing…' : 'Request export'}
          </Button>
        </div>
      </SettingsSection>

      <PrivacyControls />

      <Card className="flex flex-col items-start justify-between gap-3 border-destructive/25 p-[18px] sm:flex-row sm:items-center">
        <div>
          <h3 className="font-heading text-[13px] font-bold text-destructive">Delete account</h3>
          <p className="mt-1 text-[9px] text-muted-foreground">
            Permanently delete your profile, resume scans, applications, and interview history. This cannot be undone.
          </p>
        </div>
        {deletePartial ? (
          <div className="w-full rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-[10px] leading-relaxed text-foreground sm:max-w-[280px]">
            Your data has been erased and cannot be recovered. Removing your sign-in did not complete — contact
            support to finish closing your account.
          </div>
        ) : (
          <Dialog
            open={deleteDialogOpen}
            onOpenChange={(open) => {
              setDeleteDialogOpen(open)
              if (!open) setConfirmText('')
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" className="shrink-0 gap-2 border-destructive/30 text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4" />
                Delete account
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[420px] rounded-xl p-[23px] text-center">
              <DialogHeader className="items-center">
                <div className="grid h-[46px] w-[46px] place-items-center rounded-full bg-destructive/10 text-destructive">
                  <AlertTriangle size={22} />
                </div>
                <DialogTitle className="mt-3 font-heading text-lg font-bold text-foreground">
                  Delete your HireLoom account?
                </DialogTitle>
                <DialogDescription className="text-[11px]">
                  This permanently removes all resumes, applications, interview feedback, and account data.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-3 space-y-1.5 text-left">
                <Label htmlFor="confirmDelete" className="text-xs">
                  Type <span className="font-mono font-semibold text-foreground">{CONFIRM_PHRASE}</span> to confirm
                </Label>
                <Input
                  id="confirmDelete"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_PHRASE}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <DialogFooter className="mt-4">
                <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={!armed || deleting} className="gap-2">
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Permanently delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </Card>
    </div>
  )
}

function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  const options: { value: 'light' | 'dark' | 'system'; label: string; hint: string; icon: React.ReactNode; preview: string }[] = [
    { value: 'light', label: 'Light', hint: 'Bright and focused', icon: <Sun size={18} />, preview: 'bg-[#f8fafc] text-warning border border-border' },
    { value: 'dark', label: 'Dark', hint: 'Easy on the eyes', icon: <Moon size={18} />, preview: 'bg-[#111827] text-[#c7d2fe]' },
    { value: 'system', label: 'System', hint: 'Match this device', icon: <Laptop size={18} />, preview: 'bg-gradient-to-r from-[#f8fafc] to-[#111827] text-primary' },
  ]

  return (
    <SettingsSection title="Appearance" description="Choose how HireLoom looks on this device.">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            className={cn(
              'grid min-h-[120px] grid-cols-[1fr_auto] grid-rows-[70px_1fr] gap-x-2 gap-y-2 rounded-md border p-2.5 text-left transition-colors',
              theme === opt.value ? 'border-primary bg-secondary' : 'border-border hover:border-secondary-foreground/30'
            )}
          >
            <span className={cn('col-span-2 grid h-[62px] w-full place-items-center rounded-[7px]', opt.preview)}>{opt.icon}</span>
            <span className="grid content-center">
              <strong className={cn('text-[11px]', theme === opt.value ? 'text-primary' : 'text-foreground')}>{opt.label}</strong>
              <small className="mt-0.5 text-[9px] text-muted-foreground">{opt.hint}</small>
            </span>
            {theme === opt.value && (
              <span className="self-center text-primary">
                <Check size={16} />
              </span>
            )}
          </button>
        ))}
      </div>
    </SettingsSection>
  )
}

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('account')

  return (
    <div className="grid gap-[18px]">
      <div>
        <h2 className="font-heading text-2xl font-bold text-foreground">Settings</h2>
        <p className="mt-1 text-[10px] text-muted-foreground">Manage your account, preferences, and data.</p>
      </div>

      <div className="grid items-start gap-[14px] lg:grid-cols-[190px_1fr]">
        <Card className="sticky top-[92px] grid gap-0.5 p-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-[12px] font-bold transition-colors',
                tab === t.id ? 'bg-secondary text-primary' : 'text-foreground hover:bg-accent'
              )}
            >
              {t.label}
              <ChevronRight size={14} className={tab === t.id ? 'text-primary' : 'text-muted-foreground'} />
            </button>
          ))}
        </Card>

        <div className="grid gap-3">
          {tab === 'account' && <AccountSettings />}
          {tab === 'notifications' && <NotificationsSettings />}
          {tab === 'integrations' && <IntegrationsSettings />}
          {tab === 'billing' && <BillingSettings />}
          {tab === 'privacy' && <PrivacySettings />}
          {tab === 'appearance' && <AppearanceSettings />}
        </div>
      </div>
    </div>
  )
}
