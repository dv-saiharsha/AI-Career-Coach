import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { LandingPage } from '@/pages/LandingPage'
import { CheckoutPage } from '@/pages/checkout/CheckoutPage'
import { PaymentSuccessPage } from '@/pages/checkout/PaymentSuccessPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { ResumeUploadPage } from '@/pages/resume/ResumeUploadPage'
import { ResumeResultsPage } from '@/pages/resume/ResumeResultsPage'
import { ResumeTailorPage } from '@/pages/resume/ResumeTailorPage'
import { InterviewSetupPage } from '@/pages/interview/InterviewSetupPage'
import { InterviewSessionPage } from '@/pages/interview/InterviewSessionPage'
import { InterviewFeedbackPage } from '@/pages/interview/InterviewFeedbackPage'
import { HistoryPage } from '@/pages/history/HistoryPage'
import { ProgressPage } from '@/pages/progress/ProgressPage'
import { SettingsPage } from '@/pages/settings/SettingsPage'
import { ProfilePage } from '@/pages/profile/ProfilePage'
import { JobsPage } from '@/pages/jobs/JobsPage'
import { ApplicationsPage } from '@/pages/applications/ApplicationsPage'
import { OffersPage } from '@/pages/offers/OffersPage'
import { CoverLetterPage } from '@/pages/cover-letter/CoverLetterPage'
import { AnalyticsPage } from '@/pages/analytics/AnalyticsPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { SignupPage } from '@/pages/auth/SignupPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'
import { AuthCallbackPage } from '@/pages/auth/AuthCallbackPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

export function App() {
  return (
    <Routes>
      {/* Public Landing Page */}
      <Route path="/" element={<LandingPage />} />

      {/* Prototype checkout — no real payment processor behind this, see MIGRATION_PLAN.md */}
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/payment/success" element={<PaymentSuccessPage />} />

      {/* Auth Pages */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />

      {/* Authenticated Application Shell */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />

          {/* Resume Analyzer Module */}
          <Route path="/resume" element={<Navigate to="/resume/upload" replace />} />
          <Route path="/resume/upload" element={<ResumeUploadPage />} />
          <Route path="/resume/results" element={<ResumeResultsPage />} />
          <Route path="/resume/tailor" element={<ResumeTailorPage />} />

          {/* Interview Coach Module */}
          <Route path="/interview" element={<Navigate to="/interview/setup" replace />} />
          <Route path="/interview/setup" element={<InterviewSetupPage />} />
          <Route path="/interview/session" element={<InterviewSessionPage />} />
          <Route path="/interview/feedback" element={<InterviewFeedbackPage />} />

          {/* Job Portal */}
          <Route path="/jobs" element={<JobsPage />} />

          {/* Application Pipeline */}
          <Route path="/applications" element={<ApplicationsPage />} />

          {/* Offer Comparison */}
          <Route path="/offers" element={<OffersPage />} />

          {/* Cover Letter Generator */}
          <Route path="/cover-letter" element={<CoverLetterPage />} />

          {/* Career Analytics & Records */}
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      {/* 404 Routes */}
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
