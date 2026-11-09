import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  BarChart3, PieChart, TrendingUp, FileText,
  ArrowRight, Loader2, ShieldCheck, Globe, Layers,
} from "lucide-react";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/*  Brand metrics shown on the left panel                              */
/* ------------------------------------------------------------------ */
const metrics = [
  { icon: BarChart3, label: "Analytics", desc: "Temps réel" },
  { icon: PieChart, label: "Rapports", desc: "Automatisés" },
  { icon: TrendingUp, label: "Croissance", desc: "Prédictive" },
  { icon: FileText, label: "Factures", desc: "Multi-devises" },
];

const trustBadges = [
  { icon: ShieldCheck, text: "Conforme OHADA" },
  { icon: Globe, text: "Multi-entités" },
  { icon: Layers, text: "Intégration GL" },
];

const Login = () => {
  const navigate = useNavigate();
  const { signIn, signUp, resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (mode === "forgot") {
      const { error } = await resetPassword(email);
      setLoading(false);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Lien de réinitialisation envoyé par email");
        setMode("login");
      }
      return;
    }

    if (mode === "signup") {
      const { error } = await signUp(email, password, fullName);
      setLoading(false);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Vérifiez votre email pour confirmer votre compte");
        setMode("login");
      }
      return;
    }

    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      toast.error("Email ou mot de passe incorrect");
    } else {
      navigate("/");
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* ── Left Brand Panel ── */}
      <div className="hidden lg:flex lg:w-[48%] bg-primary relative overflow-hidden flex-col justify-between p-10 text-primary-foreground">
        {/* Floating decorative orbs */}
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-primary-foreground/[0.06] animate-float" />
        <div className="absolute -bottom-16 -left-16 w-56 h-56 rounded-full bg-primary-foreground/[0.04] animate-float [animation-delay:2s]" />
        <div className="absolute top-1/3 left-8 w-24 h-24 rounded-full bg-primary-foreground/[0.05] animate-pulse-soft" />
        <div className="absolute bottom-1/3 right-12 w-16 h-16 rounded-full bg-primary-foreground/[0.03] animate-pulse-soft [animation-delay:1.5s]" />

        {/* Top – Logo */}
        <div className="relative z-10 animate-fade-in-left">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-lg bg-primary-foreground/15 backdrop-blur-sm flex items-center justify-center border border-primary-foreground/10">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight">QUOREICH</span>
              <span className="text-[10px] ml-1.5 font-light tracking-widest opacity-60 uppercase">ERP</span>
            </div>
          </div>
        </div>

        {/* Centre – Metrics grid */}
        <div className="relative z-10 flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
          <div className="grid grid-cols-2 gap-3 mb-10">
            {metrics.map((m, i) => (
              <div
                key={m.label}
                className="bg-primary-foreground/[0.08] backdrop-blur-sm rounded-xl p-5 border border-primary-foreground/[0.06] group hover:bg-primary-foreground/[0.12] transition-all duration-300 animate-scale-in"
                style={{ animationDelay: `${i * 100 + 200}ms`, animationFillMode: "backwards" }}
              >
                <m.icon className="w-8 h-8 mb-3 opacity-80 group-hover:opacity-100 transition-opacity" />
                <p className="text-sm font-semibold">{m.label}</p>
                <p className="text-xs opacity-50 mt-0.5">{m.desc}</p>
              </div>
            ))}
          </div>

          <div className="animate-fade-in [animation-delay:600ms]" style={{ animationFillMode: "backwards" }}>
            <h1 className="text-2xl font-bold leading-tight mb-3 tracking-tight">
              La comptabilité intelligente
              <br />
              <span className="font-light opacity-80">pour l'entreprise africaine</span>
            </h1>
            <p className="text-sm leading-relaxed opacity-60 max-w-xs">
              Automatisez vos finances, pilotez vos flux en temps réel et prenez des décisions éclairées — dans une plateforme unique conforme OHADA.
            </p>
          </div>
        </div>

        {/* Bottom – Trust badges */}
        <div className="relative z-10 flex items-center gap-5 animate-fade-in [animation-delay:800ms]" style={{ animationFillMode: "backwards" }}>
          {trustBadges.map((b) => (
            <div key={b.text} className="flex items-center gap-1.5 text-xs opacity-50">
              <b.icon className="w-3.5 h-3.5" />
              <span>{b.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right Auth Panel ── */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[420px] animate-fade-in-right">
          {/* Mobile logo */}
          <div className="mb-8 text-center lg:hidden">
            <div className="flex items-center gap-2 justify-center">
              <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold text-foreground tracking-tight">QUOREICH</span>
            </div>
          </div>

          {/* Auth card */}
          <div className="bg-card rounded-xl shadow-lg border border-border p-8 animate-scale-in [animation-delay:150ms]" style={{ animationFillMode: "backwards" }}>
            {/* Header */}
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-card-foreground">
                {mode === "login" && "Bienvenue"}
                {mode === "signup" && "Créer un compte"}
                {mode === "forgot" && "Mot de passe oublié"}
              </h3>
              <p className="text-muted-foreground text-sm mt-1">
                {mode === "login" && "Connectez-vous à votre espace de gestion"}
                {mode === "signup" && "Remplissez vos informations pour commencer"}
                {mode === "forgot" && "Entrez votre email pour recevoir un lien"}
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "signup" && (
                <div className="animate-fade-in">
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Nom complet
                  </label>
                  <Input
                    type="text"
                    placeholder="Jean Dupont"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    className="h-11"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Email
                </label>
                <Input
                  type="email"
                  placeholder="vous@entreprise.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11"
                />
              </div>

              {mode !== "forgot" && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Mot de passe
                  </label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="h-11"
                  />
                </div>
              )}

              {mode === "login" && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Checkbox id="remember" />
                    <label htmlFor="remember" className="text-sm text-muted-foreground cursor-pointer">
                      Se souvenir de moi
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMode("forgot")}
                    className="text-sm text-primary hover:underline font-medium"
                  >
                    Mot de passe oublié ?
                  </button>
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-11 text-base font-medium group"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    {mode === "login" && "Se connecter"}
                    {mode === "signup" && "Créer le compte"}
                    {mode === "forgot" && "Envoyer le lien"}
                    <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </Button>
            </form>

            {/* Footer link */}
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {mode === "login" ? (
                <>
                  Pas encore de compte ?{" "}
                  <button
                    onClick={() => setMode("signup")}
                    className="text-primary hover:underline font-medium"
                  >
                    Créer un compte
                  </button>
                </>
              ) : (
                <>
                  Déjà un compte ?{" "}
                  <button
                    onClick={() => setMode("login")}
                    className="text-primary hover:underline font-medium"
                  >
                    Se connecter
                  </button>
                </>
              )}
            </p>
          </div>

          {/* Bottom legal */}
          <p className="mt-6 text-center text-xs text-muted-foreground/60">
            © {new Date().getFullYear()} QUOREICH · Tous droits réservés
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
