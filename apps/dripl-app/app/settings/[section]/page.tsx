"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import {
  User,
  Bell,
  Palette,
  Shield,
  CreditCard,
  Keyboard,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

const SETTINGS_SECTIONS = {
  profile: {
    icon: User,
    label: "Profile",
    description: "Manage your account details",
  },
  notifications: {
    icon: Bell,
    label: "Notifications",
    description: "Configure notification preferences",
  },
  appearance: {
    icon: Palette,
    label: "Appearance",
    description: "Customize the look and feel",
  },
  security: {
    icon: Shield,
    label: "Security",
    description: "Password and authentication",
  },
  billing: {
    icon: CreditCard,
    label: "Billing",
    description: "Manage your subscription",
  },
  shortcuts: {
    icon: Keyboard,
    label: "Keyboard Shortcuts",
    description: "Customize keyboard shortcuts",
  },
} as const;

type SectionKey = keyof typeof SETTINGS_SECTIONS;

export default function SettingsPage() {
  const params = useParams();
  const section = (params.section as SectionKey) || "profile";
  const currentSection =
    SETTINGS_SECTIONS[section] || SETTINGS_SECTIONS.profile;

  return (
    <div className="min-h-dvh flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-gray-800 p-4">
        <Link href="/dashboard" className="flex items-center gap-2 mb-8">
          <ArrowLeft size={16} />
          Back to Dashboard
        </Link>

        <h1 className="text-xl font-bold mb-6">Settings</h1>

        <nav className="space-y-1">
          {Object.entries(SETTINGS_SECTIONS).map(
            ([key, { icon: Icon, label }]) => (
              <Link
                key={key}
                href={`/settings/${key}`}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                  section === key ? "bg-purple-600" : "hover:bg-gray-800"
                }`}
              >
                <Icon size={18} />
                {label}
              </Link>
            ),
          )}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold mb-2">{currentSection.label}</h2>
          <p className="text-gray-400 mb-8">{currentSection.description}</p>

          {/* Section-specific content placeholder */}
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <p className="text-gray-400">
              {section === "profile" && "Profile settings coming soon..."}
              {section === "notifications" &&
                "Notification preferences coming soon..."}
              {section === "appearance" && "Appearance settings coming soon..."}
              {section === "security" && "Security settings coming soon..."}
              {section === "billing" && "Billing information coming soon..."}
              {section === "shortcuts" &&
                "Keyboard shortcut customization coming soon..."}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
