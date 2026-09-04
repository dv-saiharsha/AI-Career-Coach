'use client';

import { useState } from 'react';
import {
  Bell,
  Lock,
  Palette,
  Trash2,
  Shield,
  Save,
  Mail,
  Sparkles,
  MessageSquareCode,
  CalendarClock,
  Eye,
  EyeOff,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { DangerZoneSection } from '@/components/settings/DangerZoneSection';
import { PrivacySection } from '@/components/settings/PrivacySection';

const MIN_PASSWORD_LENGTH = 8;

const SECTIONS = [
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'security', label: 'Security', icon: Lock },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'danger', label: 'Danger Zone', icon: Trash2 },
];

const NOTIFICATION_INFO: Record<string, { title: string; desc: string; icon: typeof Bell }> = {
  emailDigest: { title: 'Weekly Email Digest', desc: 'A summary of your progress and tips', icon: Mail },
  sessionReminders: { title: 'Session Reminders', desc: 'Reminders to practice if idle for 3+ days', icon: Bell },
  productUpdates: { title: 'Product Updates', desc: 'New features and improvements', icon: Sparkles },
  tipsAndTricks: { title: 'Tips & Tricks', desc: 'AI coaching tips for better results', icon: MessageSquareCode },
};

const DIGEST_FREQUENCIES = ['Daily', 'Weekly', 'Monthly'];

/* Both controls used to be re-implemented inline here against the raw Radix
   primitives, shadowing the project's own ui/switch and ui/select. The local
   copies had drifted: a hardcoded `bg-white` thumb (wrong in either theme,
   since the track is what carries the accent), a
   `shadow-[0_20px_60px_rgba(0,0,0,0.6)]` popover that is far too heavy on
   porcelain, and `focus:outline-none` on the trigger with only a border
   colour to signal focus. The shared components already handle all three. */
function FrequencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-48" aria-label="Digest frequency">
        <span className="flex min-w-0 items-center gap-2">
          <CalendarClock className="size-4 shrink-0 text-(--color-ink-faint)" aria-hidden="true" />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {DIGEST_FREQUENCIES.map((freq) => (
          <SelectItem key={freq} value={freq}>
            {freq}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  error,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  /* Derive a stable id from the label so the control is properly labelled
     without every caller having to invent one. */
  const id = `pw-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <Field label={label} htmlFor={id} error={error}>
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="••••••••"
        autoComplete={autoComplete ?? 'off'}
        startAdornment={<Lock />}
        endAdornment={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            className="-mr-2 size-8"
          >
            {visible ? <EyeOff /> : <Eye />}
          </Button>
        }
      />
    </Field>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [activeSection, setActiveSection] = useState('notifications');
  const [notifications, setNotifications] = useState({
    emailDigest: true,
    sessionReminders: true,
    productUpdates: false,
    tipsAndTricks: true,
  });
  const [digestFrequency, setDigestFrequency] = useState('Weekly');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);

  // Supabase's updateUser() trusts the active session rather than
  // re-checking the current password — so "Current Password" is verified
  // for real here via a sign-in call, rather than collected and silently
  // ignored. A field that implies a check it doesn't perform is the same
  // false-success problem as a button that does nothing.
  async function handleUpdatePassword() {
    setPasswordError('');
    if (!currentPassword) {
      setPasswordError('Enter your current password.');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (!user?.email) {
      setPasswordError('Could not verify your account. Try signing in again.');
      return;
    }

    setUpdatingPassword(true);
    const supabase = createClient();
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (signInError) {
        setPasswordError('Current password is incorrect.');
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setPasswordError(updateError.message);
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      toast({ title: 'Password updated', description: 'Use your new password next time you sign in.' });
    } catch {
      setPasswordError('Something went wrong. Try again.');
    } finally {
      setUpdatingPassword(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        eyebrow="Preferences"
        eyebrowIcon={Shield}
        title="Settings"
        description="Manage your account preferences."
      />

      <div className="grid grid-cols-1 md:grid-cols-[210px_1fr] gap-5">
        {/* Sidebar */}
        <div
         
         
         
          className="glass-card p-2 h-fit md:sticky md:top-6 panel-enter"
        >
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant="ghost"
              onClick={() => setActiveSection(id)}
              aria-current={activeSection === id ? 'true' : undefined}
              className={`relative w-full justify-start gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-transparent ${
                activeSection === id
                  ? id === 'danger'
                    ? 'text-danger'
                    : 'text-ink'
                  : 'text-ink-dim hover:text-ink'
              }`}
            >
              {activeSection === id && (
                <span
                 
                  className={`absolute inset-0 rounded-xl ${
                    id === 'danger' ? 'bg-danger/10' : 'bg-canvas-elevated'
                  } panel-enter`}
                  />
              )}
              <Icon className="relative z-10 size-4 shrink-0" />
              <span className="relative z-10">{label}</span>
            </Button>
          ))}
        </div>

        {/* Content */}
          <div
            key={activeSection}
           
           
           
           
            className="glass-card p-6 panel-enter"
          >
            {activeSection === 'notifications' && (
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-(--color-ink) mb-4">Notification Preferences</h2>
                {Object.entries(notifications).map(([key, value]) => {
                  const info = NOTIFICATION_INFO[key];
                  const Icon = info.icon;
                  return (
                    <div key={key} className="border-b border-(--color-canvas-line-soft) last:border-0">
                      <div className="flex items-center justify-between py-3.5 gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-(--color-canvas-line) flex items-center justify-center shrink-0">
                            <Icon className="w-4 h-4 text-(--color-ink-dim)" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-(--color-ink)">{info.title}</div>
                            <div className="text-xs text-(--color-ink-faint) mt-0.5">{info.desc}</div>
                          </div>
                        </div>
                        <Switch
                          checked={value}
                          onCheckedChange={() => setNotifications((n) => ({ ...n, [key]: !n[key as keyof typeof n] }))}
                        />
                      </div>
                      {key === 'emailDigest' && value && (
                            <div
                             
                             
                             
                             
                              className="overflow-hidden panel-enter"
                            >
                              <div className="pb-4 pl-11">
                                <label className="block text-xs font-mono uppercase tracking-widest text-(--color-ink-faint) mb-2">
                                  Digest frequency
                                </label>
                                <FrequencySelect value={digestFrequency} onChange={setDigestFrequency} />
                              </div>
                            </div>
                      )}
                    </div>
                  );
                })}
                {/* Deliberately disabled, not wired to a no-op. There is no
                    preferences endpoint and no column on `profiles` to store
                    any of this yet, so the toggles above are a local preview.
                    A button that appears to save and silently discards is
                    worse than one that says so. */}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button disabled>
                    <Save />
                    Save preferences
                  </Button>
                  <p className="text-xs text-(--color-ink-faint)">
                    Notification preferences aren&apos;t stored yet — these toggles preview the
                    settings, they don&apos;t persist.
                  </p>
                </div>
              </div>
            )}

            {activeSection === 'security' && (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-(--color-ink)">Security Settings</h2>
                <div className="space-y-4 max-w-sm">
                  <PasswordField
                    label="Current Password"
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    autoComplete="current-password"
                  />
                  <PasswordField
                    label="New Password"
                    value={newPassword}
                    onChange={setNewPassword}
                    error={passwordError || undefined}
                    autoComplete="new-password"
                  />
                  <Button onClick={handleUpdatePassword} disabled={updatingPassword} aria-busy={updatingPassword || undefined}>
                    {updatingPassword ? <Spinner className="text-on-accent" label="Updating" /> : <Lock />}
                    {updatingPassword ? 'Updating…' : 'Update password'}
                  </Button>
                </div>
              </div>
            )}

            {activeSection === 'danger' && <DangerZoneSection />}

            {activeSection === 'privacy' && <PrivacySection />}

            {activeSection === 'appearance' && (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <div className="relative w-14 h-14 mb-4">
                  <div className="absolute inset-0 rounded-full heartbeat-glow" style={{ boxShadow: '0 0 22px 6px rgba(var(--glow-rgb),0.12)' }} />
                  <div className="relative w-14 h-14 rounded-full bg-(--color-accent)/10 border border-(--color-accent)/20 flex items-center justify-center">
                    <Palette className="w-5 h-5 text-(--color-accent)" />
                  </div>
                </div>
                <span className="eyebrow mb-3">Coming soon</span>
                <div className="text-sm font-medium text-(--color-ink)">
                  Custom appearance controls
                </div>
                <div className="text-xs text-(--color-ink-faint) mt-1 max-w-xs">
                  We&apos;re building theme and density options. This section is under development.
                </div>
              </div>
            )}
          </div>
      </div>
    </div>
  );
}
