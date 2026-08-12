'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as DialogPrimitive from '@radix-ui/react-dialog';
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
  TriangleAlert,
  ChevronDown,
  Check,
  LoaderCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { springSnappy } from '@/lib/motion';

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

function Switch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: () => void }) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/50 data-[state=checked]:bg-[var(--color-accent)] data-[state=unchecked]:bg-[var(--color-canvas-line)]"
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}

function FrequencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange}>
      <SelectPrimitive.Trigger className="relative w-full sm:w-48 flex items-center gap-2 bg-[var(--color-canvas)] border border-[var(--color-canvas-line)] rounded-xl pl-10 pr-3 py-2.5 text-sm text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)] data-[state=open]:border-[var(--color-accent)] transition-colors">
        <CalendarClock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-ink-faint)] pointer-events-none" />
        <SelectPrimitive.Value className="flex-1 text-left" />
        <SelectPrimitive.Icon>
          <ChevronDown className="w-4 h-4 text-[var(--color-ink-faint)]" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="overflow-hidden bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] z-50 w-[var(--radix-select-trigger-width)]"
        >
          <SelectPrimitive.Viewport className="p-1">
            {DIGEST_FREQUENCIES.map((freq) => (
              <SelectPrimitive.Item
                key={freq}
                value={freq}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-sm text-[var(--color-ink-dim)] data-[highlighted]:bg-[var(--color-accent)]/10 data-[highlighted]:text-[var(--color-ink)] outline-none cursor-pointer transition-colors"
              >
                <SelectPrimitive.ItemText>{freq}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  /* Derive a stable id from the label so the control is properly labelled
     without every caller having to invent one. */
  const id = `pw-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="••••••••"
        autoComplete="off"
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = () => {
    setDeleting(true);
    setTimeout(() => {
      setDeleting(false);
      setDeleteOpen(false);
    }, 1200);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <span className="section-eyebrow-violet mb-3 inline-flex">
          <Shield className="w-3 h-3" />
          Preferences
        </span>
        <h1 className="text-2xl sm:text-3xl font-display font-semibold text-[var(--color-ink)] mb-1">Settings</h1>
        <p className="text-sm text-[var(--color-ink-dim)]">Manage your account preferences.</p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-[210px_1fr] gap-5">
        {/* Sidebar */}
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card p-2 h-fit md:sticky md:top-6"
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
                <motion.span
                  layoutId="settings-active-pill"
                  className={`absolute inset-0 rounded-xl ${
                    id === 'danger' ? 'bg-danger/10' : 'bg-canvas-elevated'
                  }`}
                  transition={springSnappy}
                />
              )}
              <Icon className="relative z-10 size-4 shrink-0" />
              <span className="relative z-10">{label}</span>
            </Button>
          ))}
        </motion.div>

        {/* Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="glass-card p-6"
          >
            {activeSection === 'notifications' && (
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-[var(--color-ink)] mb-4">Notification Preferences</h2>
                {Object.entries(notifications).map(([key, value]) => {
                  const info = NOTIFICATION_INFO[key];
                  const Icon = info.icon;
                  return (
                    <div key={key} className="border-b border-[var(--color-canvas-line-soft)] last:border-0">
                      <div className="flex items-center justify-between py-3.5 gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-[var(--color-canvas-line)] flex items-center justify-center shrink-0">
                            <Icon className="w-4 h-4 text-[var(--color-ink-dim)]" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[var(--color-ink)]">{info.title}</div>
                            <div className="text-xs text-[var(--color-ink-faint)] mt-0.5">{info.desc}</div>
                          </div>
                        </div>
                        <Switch
                          checked={value}
                          onCheckedChange={() => setNotifications((n) => ({ ...n, [key]: !n[key as keyof typeof n] }))}
                        />
                      </div>
                      {key === 'emailDigest' && (
                        <AnimatePresence initial={false}>
                          {value && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="pb-4 pl-11">
                                <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-ink-faint)] mb-2">
                                  Digest frequency
                                </label>
                                <FrequencySelect value={digestFrequency} onChange={setDigestFrequency} />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      )}
                    </div>
                  );
                })}
                <Button className="mt-4">
                  <Save />
                  Save preferences
                </Button>
              </div>
            )}

            {activeSection === 'security' && (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-[var(--color-ink)]">Security Settings</h2>
                <div className="space-y-4 max-w-sm">
                  <PasswordField label="Current Password" value={currentPassword} onChange={setCurrentPassword} />
                  <PasswordField label="New Password" value={newPassword} onChange={setNewPassword} />
                  <Button>
                    <Lock />
                    Update password
                  </Button>
                </div>
              </div>
            )}

            {activeSection === 'danger' && (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-[var(--color-error)]">Danger Zone</h2>
                <div className="p-4 bg-[var(--color-error)]/5 border border-[var(--color-error)]/20 rounded-xl">
                  <div className="text-sm font-medium text-[var(--color-ink)] mb-1">Delete Account</div>
                  <div className="text-xs text-[var(--color-ink-dim)] mb-4">
                    Permanently delete your account and all associated data. This action cannot be undone.
                  </div>

                  <DialogPrimitive.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
                    <DialogPrimitive.Trigger asChild>
                      <Button
                        variant="outline"
                        className="border-danger/25 bg-danger/10 text-danger hover:bg-danger/20"
                      >
                        <Trash2 />
                        Delete my account
                      </Button>
                    </DialogPrimitive.Trigger>

                    <AnimatePresence>
                      {deleteOpen && (
                        <DialogPrimitive.Portal forceMount>
                          <DialogPrimitive.Overlay asChild forceMount>
                            <motion.div
                              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.15 }}
                            />
                          </DialogPrimitive.Overlay>
                          <DialogPrimitive.Content asChild forceMount>
                            <motion.div
                              className="fixed left-1/2 top-1/2 w-[90vw] max-w-md bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] rounded-2xl p-6 z-50 shadow-[0_20px_80px_rgba(0,0,0,0.6)]"
                              initial={{ opacity: 0, scale: 0.95, x: '-50%', y: '-45%' }}
                              animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                              exit={{ opacity: 0, scale: 0.95, x: '-50%', y: '-45%' }}
                              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                            >
                              <div className="w-11 h-11 rounded-full bg-[var(--color-error)]/10 border border-[var(--color-error)]/25 flex items-center justify-center mb-4">
                                <TriangleAlert className="w-5 h-5 text-[var(--color-error)]" />
                              </div>
                              <DialogPrimitive.Title className="text-base font-semibold text-[var(--color-ink)] mb-1.5">
                                Delete your account?
                              </DialogPrimitive.Title>
                              <DialogPrimitive.Description className="text-sm text-[var(--color-ink-dim)] mb-6 leading-relaxed">
                                This permanently deletes your resumes, interview history, and progress. This action cannot
                                be undone.
                              </DialogPrimitive.Description>
                              <div className="flex items-center justify-end gap-3">
                                <DialogPrimitive.Close asChild>
                                  <Button variant="ghost">Cancel</Button>
                                </DialogPrimitive.Close>
                                <Button
                                  variant="destructive"
                                  onClick={handleDelete}
                                  disabled={deleting}
                                  aria-busy={deleting || undefined}
                                >
                                  {deleting ? (
                                    <>
                                      <Spinner className="text-on-accent" label="Deleting" />
                                      Deleting…
                                    </>
                                  ) : (
                                    <>
                                      <Trash2 />
                                      Yes, delete account
                                    </>
                                  )}
                                </Button>
                              </div>
                            </motion.div>
                          </DialogPrimitive.Content>
                        </DialogPrimitive.Portal>
                      )}
                    </AnimatePresence>
                  </DialogPrimitive.Root>
                </div>
              </div>
            )}

            {(activeSection === 'appearance' || activeSection === 'privacy') && (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <div className="relative w-14 h-14 mb-4">
                  <div className="absolute inset-0 rounded-full heartbeat-glow" style={{ boxShadow: '0 0 22px 6px rgba(var(--glow-rgb),0.12)' }} />
                  <div className="relative w-14 h-14 rounded-full bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 flex items-center justify-center">
                    {activeSection === 'appearance' ? (
                      <Palette className="w-5 h-5 text-[var(--color-accent)]" />
                    ) : (
                      <Shield className="w-5 h-5 text-[var(--color-accent)]" />
                    )}
                  </div>
                </div>
                <span className="section-eyebrow-violet mb-3">Coming soon</span>
                <div className="text-sm font-medium text-[var(--color-ink)]">
                  {activeSection === 'appearance' ? 'Custom appearance controls' : 'Advanced privacy controls'}
                </div>
                <div className="text-xs text-[var(--color-ink-faint)] mt-1 max-w-xs">
                  {activeSection === 'appearance'
                    ? "We're building theme and density options. This section is under development."
                    : 'Data export and granular sharing controls are on the way.'}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
