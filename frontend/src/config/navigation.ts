import {
  BarChart3,
  BriefcaseBusiness,
  ClipboardList,
  FileText,
  Gift,
  History,
  LayoutDashboard,
  MessageSquareText,
  Settings,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

// Mirrors figma-export/src/data/mockData.ts's `navGroups` — same grouping,
// labels, and icons — remapped onto this app's real routes.
export const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { label: 'Analytics', path: '/analytics', icon: BarChart3 },
      { label: 'Progress', path: '/progress', icon: TrendingUp },
    ],
  },
  {
    label: 'Prepare',
    items: [
      { label: 'Resume Match & Optimization', path: '/resume/match', icon: FileText },
      { label: 'Cover Letter Generator', path: '/cover-letter', icon: FileText },
      { label: 'Interview Coach', path: '/interview', icon: MessageSquareText },
    ],
  },
  {
    label: 'Apply',
    items: [
      { label: 'Job Portal', path: '/jobs', icon: BriefcaseBusiness },
      { label: 'Applications', path: '/applications', icon: ClipboardList },
      { label: 'Offer Comparison', path: '/offers', icon: Gift },
    ],
  },
  {
    label: 'Account',
    items: [
      { label: 'History', path: '/history', icon: History },
      { label: 'Profile', path: '/profile', icon: UserRound },
      { label: 'Settings', path: '/settings', icon: Settings },
    ],
  },
]

export const allNavItems: NavItem[] = navGroups.flatMap((group) => group.items)

// Mirrors figma-export's `quickActions`.
export const quickActions: NavItem[] = [
  { label: 'Resume Match & Optimization', path: '/resume/match', icon: FileText },
  { label: 'Practice interview', path: '/interview/setup', icon: MessageSquareText },
  { label: 'Track application', path: '/applications', icon: ClipboardList },
]
