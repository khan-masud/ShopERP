"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { z } from "zod";
import { Store } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const lowStockDismissKey = "shoperp.warning.dismiss.low";
const outOfStockDismissKey = "shoperp.warning.dismiss.out";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password minimum 8 characters"),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    async function verifySession() {
      try {
        const res = await fetch("/api/auth/me", {
          cache: "no-store",
        });

        if (res.ok) {
          router.replace("/dashboard");
          return;
        }
      } catch {
        // Keep on login page when auth check fails.
      } finally {
        setIsCheckingSession(false);
      }
    }

    void verifySession();
  }, [router]);

  async function onSubmit(values: LoginValues) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(values),
    });

    const payload = (await res.json().catch(() => null)) as
      | { success: boolean; message?: string }
      | null;

    if (!res.ok || !payload?.success) {
      toast.error(payload?.message ?? "Login failed");
      return;
    }

    try {
      window.sessionStorage.removeItem(lowStockDismissKey);
      window.sessionStorage.removeItem(outOfStockDismissKey);
    } catch {
      // Ignore storage cleanup failures.
    }

    toast.success("Login successful");

    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next && next.startsWith("/") ? next : "/dashboard");
    router.refresh();
  }

  if (isCheckingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="rounded-xl border border-white/20 bg-white/5 px-6 py-4 text-sm text-slate-300 backdrop-blur-md">
          Checking secure session...
        </div>
      </div>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes float-blob {
            0% { transform: translate(0px, 0px) scale(1); }
            33% { transform: translate(40px, -60px) scale(1.1); }
            66% { transform: translate(-30px, 30px) scale(0.9); }
            100% { transform: translate(0px, 0px) scale(1); }
          }
          .animate-float-blob {
            animation: float-blob 10s infinite alternate ease-in-out;
          }
          .delay-2000 { animation-delay: 2s; }
          .delay-4000 { animation-delay: 4s; }
          .delay-6000 { animation-delay: 6s; }
        `
      }} />

      <div className="relative flex h-screen min-h-screen items-center justify-center overflow-hidden bg-black p-6">
        
        {/* Animated Background Elements */}
        <div className="pointer-events-none absolute inset-0">
          <div className="animate-float-blob absolute -left-20 -top-20 h-96 w-96 rounded-full bg-blue-600/30 mix-blend-screen blur-[120px] filter"></div>
          <div className="animate-float-blob delay-2000 absolute right-1/4 top-1/4 h-80 w-80 rounded-full bg-emerald-600/30 mix-blend-screen blur-[100px] filter"></div>
          <div className="animate-float-blob delay-4000 absolute bottom-1/4 left-1/3 h-[500px] w-[500px] rounded-full bg-purple-600/30 mix-blend-screen blur-[150px] filter"></div>
          <div className="animate-float-blob delay-6000 absolute left-1/4 top-1/2 h-72 w-72 rounded-full bg-rose-600/20 mix-blend-screen blur-[100px] filter"></div>
        </div>

        {/* Centered Login Form */}
        <div className="relative z-10 w-full max-w-md rounded-[28px] border border-white/20 bg-white/95 p-8 shadow-[0_30px_60px_rgba(0,0,0,0.5)] backdrop-blur-2xl md:p-10">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-xl ring-4 ring-slate-900/5">
              <Store size={28} />
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-slate-950">Welcome to ShopERP</h1>
            <p className="mt-2 text-sm text-slate-500">Secure Operations Console</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <Input
              label="Email Address"
              type="email"
              autoComplete="email"
              placeholder="owner@example.com"
              error={errors.email?.message}
              {...register("email")}
            />
            <div className="space-y-1.5">
              <Input
                label="Password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                error={errors.password?.message}
                {...register("password")}
              />
            </div>
            <Button type="submit" className="w-full bg-slate-950 py-3 text-sm hover:bg-slate-800" size="lg" disabled={isSubmitting}>
              {isSubmitting ? "Authenticating..." : "Secure Login"}
            </Button>
          </form>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 px-4 text-center text-xs text-slate-300">
          Developed by{" "}
          <a
            href="https://facebook.com/abdullahalmasud.khan.1"
            target="_blank"
            rel="noreferrer"
            className="pointer-events-auto font-medium text-blue-400 hover:text-blue-300 hover:underline"
          >
            Abdullah Al Masud
          </a>
        </div>
      </div>
    </>
  );
}
