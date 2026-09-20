import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import { AuthProvider } from './auth.jsx';
import Layout from './components/Layout.jsx';
import AdminLayout from './components/AdminLayout.jsx';
import Home from './pages/Home.jsx';
import NewTicket from './pages/NewTicket.jsx';
import Track from './pages/Track.jsx';
import Contact from './pages/Contact.jsx';
import AdminInbox from './pages/AdminInbox.jsx';
import AdminLogin from './pages/AdminLogin.jsx';
import AdminOverview from './pages/AdminOverview.jsx';
import AdminTickets from './pages/AdminTickets.jsx';
import StaffTicket from './pages/StaffTicket.jsx';
import StaffAnalytics from './pages/StaffAnalytics.jsx';
import StaffEscalations from './pages/StaffEscalations.jsx';
import AdminSettings from './pages/AdminSettings.jsx';
import AdminAudit from './pages/AdminAudit.jsx';
import AdminProfile from './pages/AdminProfile.jsx';
import Chat from './pages/Chat.jsx';
import Privacy from './pages/Privacy.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* ---------- public student site (no staff links anywhere) ---------- */}
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/new-ticket" element={<NewTicket />} />
            <Route path="/track" element={<Track />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>

          {/* ---------- private live chat (token from the student's email) ---------- */}
          <Route path="/chat/:token" element={<Chat />} />

          {/* ---------- hidden staff portal at /admin ---------- */}
          <Route path="/admin" element={<AdminLogin />} />
          <Route element={<AdminLayout />}>
            <Route path="/admin/dashboard" element={<AdminOverview />} />
            <Route path="/admin/tickets" element={<AdminTickets />} />
            <Route path="/admin/my-tickets" element={<AdminTickets mine />} />
            <Route path="/admin/escalations" element={<StaffEscalations />} />
            <Route path="/admin/inbox" element={<AdminInbox />} />
            <Route path="/admin/analytics" element={<StaffAnalytics />} />
            <Route path="/admin/audit" element={<AdminAudit />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
            <Route path="/admin/profile" element={<AdminProfile />} />
            <Route path="/admin/tickets/:id" element={<StaffTicket />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
