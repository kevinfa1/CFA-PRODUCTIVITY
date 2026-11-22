import { useState, type FormEvent } from "react";
import { api } from "../api";
import type { AuthSession } from "../types";
import "./LoginView.css";

export function LoginView({ onAuthenticated }: { onAuthenticated: (session: AuthSession) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Ingrese su usuario y contraseña.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const session = await api.login(username.trim(), password);
      onAuthenticated(session);
    } catch (err) {
      setError((err as Error).message || "Usuario o contraseña incorrectos");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-screen">
      <section className="login-card" aria-label="Inicio de sesión CFA">
        <header className="login-header">
          <div className="login-eyebrow">CFA · CONTROL DE OBRA</div>
          <h1 className="login-title">Iniciar Sesión</h1>
          <p className="login-sub">Módulo de Asistencia Global de Obra</p>
        </header>

        <form className="login-form" onSubmit={(e) => void handleSubmit(e)}>
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <div className="login-field">
            <label className="login-label" htmlFor="login-username">
              Usuario
            </label>
            <input
              id="login-username"
              className="login-input"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="Ej. maestro"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="login-password">
              Contraseña
            </label>
            <div className="login-input-wrap">
              <input
                id="login-password"
                className="login-input"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Ingrese su contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="login-toggle-btn"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? "Ocultar" : "Ver"}
              </button>
            </div>
          </div>

          <button id="btn-login-submit" type="submit" className="login-submit" disabled={loading}>
            {loading ? "Verificando..." : "Entrar a Asistencia"}
          </button>
        </form>
      </section>
    </main>
  );
}
