"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { z } from "zod";
import { ShieldCheck, Store } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

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

    toast.success("Login successful");

    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next && next.startsWith("/") ? next : "/dashboard");
    router.refresh();
  }

  if (isCheckingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600">
          Checking secure session...
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen bg-slate-100 lg:grid-cols-5">
      <section className="relative hidden overflow-hidden bg-slate-950 lg:col-span-2 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,0.35),transparent_45%),radial-gradient(circle_at_85%_70%,rgba(5,150,105,0.28),transparent_40%)]" />
        <div className="relative flex h-full flex-col justify-between px-10 py-12 text-white">
          <div className="space-y-3">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs">
              <ShieldCheck size={14} />
              Security First ERP Access
            </p>
            <h1 className="text-3xl font-semibold leading-tight">
              ShopERP
              <br />
              Secure Operations Console
            </h1>
            <p className="max-w-md text-sm text-slate-200">
              Protected login for admins and staff with audit-tracked sessions and real-time
              retail workflows.
            </p>
          </div>
          <div className="text-xs text-slate-300">Bangladesh Retail Edition</div>
        </div>
      </section>

      <section className="flex items-center justify-center p-6 lg:col-span-3">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
          <div className="mb-6 flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
              <Store size={18} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Sign in to ShopERP</h2>
              <p className="text-xs text-slate-500">Use your email and password to sign in</p>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="owner@example.com"
              error={errors.email?.message}
              {...register("email")}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              placeholder="********"
              error={errors.password?.message}
              {...register("password")}
            />
            <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Secure Login"}
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
