import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminGuard, AuthBootstrap, ProtectedRoute, PublicOnlyRoute } from './routes/guards';
import LoginPage from './routes/auth/LoginPage';
import RegisterPage from './routes/auth/RegisterPage';
import BootstrapAdminPage from './routes/auth/BootstrapAdminPage';
import AppShell from './routes/app/AppShell';
import ChatPage from './routes/app/ChatPage';
import SettingsPage from './routes/app/SettingsPage';
import MarketPage from './routes/app/MarketPage';
import MarketDetailPage from './routes/app/MarketDetailPage';

const App = () => (
  <AuthBootstrap>
    <Routes>
      <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
      <Route path="/register" element={<PublicOnlyRoute><RegisterPage /></PublicOnlyRoute>} />
      <Route
        path="/bootstrap-admin"
        element={<PublicOnlyRoute><BootstrapAdminPage /></PublicOnlyRoute>}
      />
      <Route
        path="/app"
        element={<ProtectedRoute><AppShell /></ProtectedRoute>}
      >
        <Route index element={<ChatPage />} />
        <Route path="session/:sessionId" element={<ChatPage />} />
        <Route path="settings" element={<AdminGuard><SettingsPage /></AdminGuard>} />
        <Route path="market" element={<MarketPage />} />
        <Route path="market/:publisher/:name" element={<MarketDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  </AuthBootstrap>
);

export default App;
