import React, { useEffect, useRef, useState } from 'react';
import { api, apiUpload, useAuth } from '../auth.jsx';

/**
 * My Profile — every staff member sets this up on first login.
 * The portal blocks ticket work until gender + phone are filled and the
 * temporary password has been replaced with their own.
 */
export default function AdminProfile() {
  const { user, signIn, updateUser } = useAuth();
  const [me, setMe] = useState(null);
  const [msg, setMsg] = useState({ ok: '', err: '' });
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [details, setDetails] = useState({ phone: '', gender: '' });
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef(null);

  function load() {
    api('/auth/me').then((d) => {
      setMe(d.user);
      setDetails({ phone: d.user.phone || '', gender: d.user.gender || '' });
    }).catch((e) => setMsg({ ok: '', err: e.message }));
  }
  useEffect(load, []);

  if (!me) return <div className="loading">Loading your profile…</div>;

  const needsPassword = !!me.mustChangePassword;
  const needsDetails = !me.gender || !me.phone;
  const blocked = needsPassword || needsDetails;

  async function saveDetails(e) {
    e.preventDefault();
    setMsg({ ok: '', err: '' });
    try {
      const d = await api('/auth/me', { method: 'POST', body: JSON.stringify(details) });
      setMsg({ ok: 'Profile saved.', err: '' });
      setMe((m) => ({ ...m, ...d.user }));
      // The server's presentUser() is the truth for profileComplete — sync
      // with the FULL returned user so the gate can never show stale state.
      refreshSessionUser(d.user);
    } catch (err) { setMsg({ ok: '', err: err.message }); }
  }

  async function changePassword(e) {
    e.preventDefault();
    setMsg({ ok: '', err: '' });
    if (pwd.next !== pwd.confirm) { setMsg({ ok: '', err: 'The two new passwords do not match' }); return; }
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: pwd.current, newPassword: pwd.next }) });
      setMsg({ ok: 'Password changed — you now have your own.', err: '' });
      setPwd({ current: '', next: '', confirm: '' });
      setMe((m) => ({ ...m, mustChangePassword: false }));
      refreshSessionUser({ mustChangePassword: false });
    } catch (err) { setMsg({ ok: '', err: err.message }); }
  }

  /** Keep the whole app (sidebar photo, top bar, gates) in sync after profile changes. */
  function refreshSessionUser(patch) {
    try {
      const raw = localStorage.getItem('rugipo.staff');
      if (!raw) return;
      const session = JSON.parse(raw);
      const nextUser = { ...session.user, ...patch };
      // profileComplete is derived, never trusted from a partial patch.
      nextUser.profileComplete = !!(nextUser.gender && nextUser.phone);
      nextUser.mustChangePassword = !!nextUser.mustChangePassword;
      session.user = nextUser;
      localStorage.setItem('rugipo.staff', JSON.stringify(session));
      updateUser(nextUser); // updates the React context too — gate + sidebar refresh instantly
    } catch { /* ignore */ }
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setMsg({ ok: '', err: 'That photo is larger than 2 MB — choose a smaller one' }); e.target.value = ''; return; }
    setPhotoBusy(true); setMsg({ ok: '', err: '' });
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const d = await apiUpload('/auth/me/photo', fd);
      setMsg({ ok: 'Photo updated — it now shows in the sidebar.', err: '' });
      setMe((m) => ({ ...m, profileImage: d.imageUrl }));
      refreshSessionUser({ profileImage: d.imageUrl });
    } catch (err) { setMsg({ ok: '', err: err.message }); }
    finally { setPhotoBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function deletePhoto() {
    setPhotoBusy(true); setMsg({ ok: '', err: '' });
    try {
      await api('/auth/me/photo', { method: 'DELETE' });
      setMe((m) => ({ ...m, profileImage: null }));
      refreshSessionUser({ profileImage: null });
      setMsg({ ok: 'Photo removed.', err: '' });
    } catch (err) { setMsg({ ok: '', err: err.message }); }
    finally { setPhotoBusy(false); }
  }

  const photoUrl = me.profileImage
    ? (me.profileImage.startsWith('http') ? me.profileImage : `/api/auth/me/photo?v=${me.id}`)
    : null;

  return (
    <>
      <h2 className="section__title">My profile</h2>
      <p className="section__sub">Your details, your photo and your password — colleagues see your name beside every complaint you handle.</p>

      {blocked && (
        <div className="notice notice--err" role="alert">
          <strong>Action needed before you can start</strong> — {needsPassword && !needsDetails && 'choose your own password below.'}
          {needsDetails && !needsPassword && 'add your gender and phone number below, then save.'}
          {needsPassword && needsDetails && 'set your own password and add your gender and phone number below, then save.'}
          {' '}Complaint work stays locked until this is done.
        </div>
      )}
      {msg.ok && <div className="notice notice--ok">{msg.ok}</div>}
      {msg.err && <div className="notice notice--err">{msg.err}</div>}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)', gap: 16 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="profile-photo-wrap">
            {photoUrl
              ? <img className="profile-photo" src={photoUrl} alt="My profile" />
              : <div className="profile-photo profile-photo--empty">{me.fullName.split(/\s+/).map(w => w[0]).slice(0, 2).join('')}</div>}
          </div>
          <label className="btn btn--outline btn--sm" style={{ cursor: 'pointer', display: 'inline-block', marginTop: 10 }}>
            {photoBusy ? 'Uploading…' : me.profileImage ? 'Change photo' : 'Add a photo'}
            <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp,.gif" hidden onChange={uploadPhoto} />
          </label>
          {me.profileImage && (
            <button type="button" className="btn btn--outline btn--sm" style={{ display: 'block', margin: '8px auto 0', color: '#991b1b' }}
              disabled={photoBusy} onClick={deletePhoto}>
              Remove photo
            </button>
          )}
          <p className="muted" style={{ fontSize: '.78rem', marginTop: 6 }}>PNG, JPG, WEBP or GIF · up to 2 MB</p>
        </div>

        <div>
          <div className="card mb">
            <strong>My details</strong>
            <form onSubmit={saveDetails} className="mt">
              <div className="form-grid">
                <label className="field"><span>Full name</span><input value={me.fullName} disabled /></label>
                <label className="field"><span>Work email</span><input value={me.email} disabled /></label>
                <label className="field"><span>Staff ID</span><input value={me.staffNo || '—'} disabled /></label>
                <label className="field"><span>Role</span>
                  <input value={me.role === 'admin' ? 'Super ICT Support' : me.role === 'senior' ? (me.specialty === 'payment' ? 'Payment Gateway Provider' : 'Portal Support Engineer') : 'ICT Support Staff'} disabled />
                </label>
                <label className="field"><span>Gender</span>
                  <select value={details.gender} required onChange={(e) => setDetails({ ...details, gender: e.target.value })}>
                    <option value="">Select…</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </label>
                <label className="field"><span>Phone number</span>
                  <input value={details.phone} required placeholder="080…" onChange={(e) => setDetails({ ...details, phone: e.target.value })} />
                </label>
              </div>
              <button className="btn btn--navy btn--sm">Save details</button>
            </form>
          </div>

          <div className="card">
            <strong>{needsPassword ? 'Choose your own password' : 'Change password'}</strong>
            {needsPassword
              ? <p className="muted" style={{ fontSize: '.85rem', margin: '4px 0 0' }}>You are still using the temporary password you were given. Replace it now.</p>
              : <p className="muted" style={{ fontSize: '.85rem', margin: '4px 0 0' }}>Use at least 8 characters with letters and numbers.</p>}
            <form onSubmit={changePassword} className="mt">
              <label className="field"><span>Current password</span>
                <input type="password" value={pwd.current} required autoComplete="current-password" onChange={(e) => setPwd({ ...pwd, current: e.target.value })} />
              </label>
              <div className="form-grid">
                <label className="field"><span>New password</span>
                  <input type="password" value={pwd.next} required minLength={8} autoComplete="new-password" onChange={(e) => setPwd({ ...pwd, next: e.target.value })} />
                </label>
                <label className="field"><span>Repeat new password</span>
                  <input type="password" value={pwd.confirm} required autoComplete="new-password" onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} />
                </label>
              </div>
              <button className="btn btn--navy btn--sm">{needsPassword ? 'Set my password' : 'Change password'}</button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
