// Public interface of the auth feature. Other features and shared code must not
// import from its internal files. The LoginPage is loaded by the route registry.
export {
  noticeKey,
  sessionKey,
  useChangePassword,
  useChangeUsername,
  setupKey,
  useLogin,
  useLogout,
  useSession,
  useSetupStatus,
  type AuthNotice,
  type PasswordChangeInput,
  type UsernameChangeInput,
  type SessionInfo,
  type User,
} from './api'
export { RequireAuth } from './RequireAuth'
export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, USERNAME_PATTERN } from './validation'
