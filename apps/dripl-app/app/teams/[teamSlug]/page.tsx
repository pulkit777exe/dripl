"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Users,
  Settings,
  FolderOpen,
  Plus,
  Search,
} from "lucide-react";
import Link from "next/link";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  avatar?: string;
}

interface TeamFile {
  id: string;
  name: string;
  updatedAt: Date;
  updatedBy: string;
}

const MOCK_MEMBERS: TeamMember[] = [
  { id: "1", name: "Alice Johnson", email: "alice@example.com", role: "owner" },
  { id: "2", name: "Bob Smith", email: "bob@example.com", role: "admin" },
  { id: "3", name: "Carol White", email: "carol@example.com", role: "member" },
];

const MOCK_FILES: TeamFile[] = [
  { id: "1", name: "Q1 Planning", updatedAt: new Date(), updatedBy: "Alice" },
  { id: "2", name: "Product Roadmap", updatedAt: new Date(), updatedBy: "Bob" },
  { id: "3", name: "Design System", updatedAt: new Date(), updatedBy: "Carol" },
];

export default function TeamWorkspacePage() {
  const params = useParams();
  const teamSlug = params.teamSlug as string;
  const [activeTab, setActiveTab] = useState<"files" | "members" | "settings">(
    "files",
  );

  return (
    <div className="min-h-dvh bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-gray-800 p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-gray-400 hover:text-white"
            >
              <ArrowLeft size={16} />
            </Link>
            <h1 className="text-xl font-bold capitalize">{teamSlug} Team</h1>
          </div>

          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg text-sm">
              <Plus size={16} />
              New File
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-gray-800">
        <div className="max-w-7xl mx-auto flex gap-1 px-4">
          <button
            onClick={() => setActiveTab("files")}
            className={`flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition-colors ${
              activeTab === "files"
                ? "border-purple-500 text-white"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            <FolderOpen size={16} />
            Files
          </button>
          <button
            onClick={() => setActiveTab("members")}
            className={`flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition-colors ${
              activeTab === "members"
                ? "border-purple-500 text-white"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            <Users size={16} />
            Members
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition-colors ${
              activeTab === "settings"
                ? "border-purple-500 text-white"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            <Settings size={16} />
            Settings
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        {/* Files Tab */}
        {activeTab === "files" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                  size={18}
                />
                <input
                  type="text"
                  placeholder="Search files..."
                  className="bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-purple-500 w-64"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {MOCK_FILES.map((file) => (
                <Link
                  key={file.id}
                  href={`/file/${file.id}`}
                  className="bg-gray-900 rounded-lg border border-gray-800 p-4 hover:border-purple-500 transition-colors"
                >
                  <div className="aspect-video bg-gray-800 rounded mb-3 flex items-center justify-center">
                    <FolderOpen className="text-gray-600" size={32} />
                  </div>
                  <h3 className="font-medium mb-1">{file.name}</h3>
                  <p className="text-sm text-gray-400">
                    Updated by {file.updatedBy}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Members Tab */}
        {activeTab === "members" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-medium">Team Members</h2>
              <button className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm">
                <Plus size={16} />
                Invite Member
              </button>
            </div>

            <div className="bg-gray-900 rounded-lg border border-gray-800 divide-y divide-gray-800">
              {MOCK_MEMBERS.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-10 bg-purple-600 rounded-full flex items-center justify-center text-sm font-medium">
                      {member.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-medium">{member.name}</h3>
                      <p className="text-sm text-gray-400">{member.email}</p>
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      member.role === "owner"
                        ? "bg-purple-600/20 text-purple-400"
                        : member.role === "admin"
                          ? "bg-blue-600/20 text-blue-400"
                          : "bg-gray-700 text-gray-400"
                    }`}
                  >
                    {member.role}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === "settings" && (
          <div className="max-w-2xl">
            <h2 className="text-lg font-medium mb-6">Team Settings</h2>

            <div className="space-y-6">
              <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
                <h3 className="font-medium mb-4">Team Name</h3>
                <input
                  type="text"
                  defaultValue={teamSlug}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
                <h3 className="font-medium mb-4">Danger Zone</h3>
                <button className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm">
                  Delete Team
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
