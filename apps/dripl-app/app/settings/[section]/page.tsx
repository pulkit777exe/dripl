'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft, ChevronRight, Settings, Download, Trash2, PenLine, LogOut
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/app/context/AuthContext';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';

export default function SettingsPage() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [columns, setColumns] = useState(4);
  const [scale, setScale] = useState(100);

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <div className="flex h-dvh bg-[#F0EDE6] overflow-hidden">
      {/* Re-use the exact same DashboardSidebar */}
      <DashboardSidebar />

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-auto bg-[#F0EDE6]">
        {/* Top Header Placeholder to match Dashboard (optional, or just settings header) */}
        <div className="flex items-center gap-4 border-b border-[#E4E0D9] bg-[#FAFAF7] px-6 py-3 sticky top-0 z-10">
          <div className="flex items-center gap-1">
            <button onClick={() => router.back()} className="p-1 rounded-md text-[#6B6860] hover:text-[#1A1917] hover:bg-[#E8E5DE] transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button className="p-1 rounded-md text-[#D4D0C9] transition-colors cursor-not-allowed">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-[#6B6860]" />
            <h1 className="text-[14px] font-semibold text-[#1A1917]">Settings</h1>
          </div>
        </div>

        <div className="max-w-2xl px-10 py-8 mx-auto w-full">
          <p className="text-[13px] text-[#6B6860] mb-8">
            Defaults for canvases, appearance, and data. You can still change the canvas layout from the header on any list.
          </p>

          {/* Appearance section */}
          <div className="mb-10">
            <p className="text-[12px] font-semibold text-[#6B6860] mb-3">Appearance</p>
            <div className="bg-[#FAFAF7] border border-[#E4E0D9] rounded-xl p-5 space-y-6 shadow-sm">
              {/* Theme */}
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-[#1A1917] flex items-center gap-2">Theme <span className="bg-[#E8E5DE] text-[#6B6860] text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide">Coming Soon</span></span>
                <div className="flex items-center gap-1 rounded-md border border-[#E4E0D9] bg-white p-0.5">
                  <button
                    disabled
                    className={`px-3 py-1.5 text-[12px] font-medium rounded transition-colors bg-[#E8462A] text-white opacity-50 cursor-not-allowed`}
                  >
                    System
                  </button>
                </div>
              </div>

              {/* Interface scale */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="text-[13px] font-medium text-[#1A1917]">Interface scale</span>
                    <p className="text-[12px] text-[#6B6860] mt-0.5">Matches the control in the floating menu.</p>
                  </div>
                  <Settings className="h-4 w-4 text-[#C2BEB6]" />
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex-1 relative flex items-center">
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 px-3 py-1 bg-[#6B6860] text-white text-[12px] rounded-md font-medium z-10 pointer-events-none shadow-md">
                      Scale
                    </div>
                    <input
                      type="range"
                      min={75}
                      max={150}
                      value={scale}
                      onChange={e => setScale(Number(e.target.value))}
                      className="w-full h-8 rounded-lg appearance-none bg-[#FAFAF7] border border-[#E4E0D9] cursor-pointer pl-16 outline-none"
                      style={{
                        background: `linear-gradient(to right, #E8E5DE ${((scale - 75) / 75) * 100}%, #FAFAF7 ${((scale - 75) / 75) * 100}%)`,
                      }}
                    />
                  </div>
                  <span className="text-[13px] text-[#6B6860] font-medium w-12 text-right">{scale}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Canvas (Bookmarks equivalent) section */}
          <div className="mb-10">
            <p className="text-[12px] font-semibold text-[#6B6860] mb-3">Canvases</p>
            <div className="bg-[#FAFAF7] border border-[#E4E0D9] rounded-xl p-5 space-y-6 shadow-sm">
              {/* Default layout */}
              <div>
                <span className="text-[13px] font-medium text-[#1A1917]">Default layout</span>
                <p className="text-[12px] text-[#6B6860] mt-0.5 mb-3">Starting view for All Files, collections, and Trash.</p>
                <div className="flex items-center gap-1.5 rounded-lg border border-[#E4E0D9] bg-white p-1 w-max">
                  <button
                    onClick={() => setLayout('grid')}
                    className={`flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors ${layout === 'grid' ? 'bg-[#F0EDE6] text-[#1A1917]' : 'text-[#6B6860] hover:text-[#1A1917]'}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
                    Grid
                  </button>
                  <button
                    onClick={() => setLayout('list')}
                    className={`flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors ${layout === 'list' ? 'bg-[#F0EDE6] text-[#1A1917]' : 'text-[#6B6860] hover:text-[#1A1917]'}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                    List
                  </button>
                </div>
              </div>

              {/* Grid columns */}
              <div>
                <span className="text-[13px] font-medium text-[#1A1917]">Grid columns</span>
                <p className="text-[12px] text-[#6B6860] mt-0.5 mb-3">Used when layout is grid on large screens.</p>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1 rounded-lg border border-[#E4E0D9] bg-white p-1">
                    {[3, 4, 5].map(col => (
                      <button
                        key={col}
                        onClick={() => setColumns(col)}
                        className={`p-1.5 rounded-md transition-colors ${columns === col ? 'bg-[#F0EDE6] text-[#1A1917]' : 'text-[#6B6860] hover:text-[#1A1917]'}`}
                      >
                         <div className="flex flex-wrap w-4 h-4 gap-0.5">
                           {Array.from({ length: 4 }).map((_, i) => (
                             <div key={i} className={`w-1.5 h-1.5 rounded-[1px] border border-current opacity-50`}></div>
                           ))}
                         </div>
                      </button>
                    ))}
                  </div>
                  <span className="text-[13px] text-[#6B6860] font-medium">{columns} columns</span>
                </div>
              </div>
            </div>
          </div>

          {/* Data section */}
          <div className="mb-10">
            <p className="text-[12px] font-semibold text-[#6B6860] mb-3">Data</p>
            <div className="bg-[#FAFAF7] border border-[#E4E0D9] rounded-xl flex flex-col shadow-sm">
              <button className="w-full flex items-start gap-4 p-5 hover:bg-[#F0EDE6] transition-colors text-left border-b border-[#E4E0D9] last:border-b-0 rounded-t-xl">
                <Download className="w-4 h-4 mt-0.5 text-[#9B9890]" />
                <div>
                  <p className="text-[13px] font-medium text-[#1A1917]">Import drawing</p>
                  <p className="text-[12px] text-[#6B6860] mt-0.5">Upload a JSON export from Dripl or Excalidraw.</p>
                </div>
              </button>
              <button className="w-full flex items-start gap-4 p-5 hover:bg-[#F0EDE6] transition-colors text-left border-b border-[#E4E0D9] last:border-b-0">
                <Trash2 className="w-4 h-4 mt-0.5 text-[#9B9890]" />
                <div>
                  <p className="text-[13px] font-medium text-[#1A1917]">Trash</p>
                  <p className="text-[12px] text-[#6B6860] mt-0.5">Review and restore or delete forever.</p>
                </div>
              </button>
              <button className="w-full flex items-start gap-4 p-5 hover:bg-[#F0EDE6] transition-colors text-left rounded-b-xl border-b border-[#E4E0D9] last:border-b-0">
                <PenLine className="w-4 h-4 mt-0.5 text-[#9B9890]" />
                <div>
                  <p className="text-[13px] font-medium text-[#1A1917]">Canvas</p>
                  <p className="text-[12px] text-[#6B6860] mt-0.5">Open your board to arrange saved links visually.</p>
                </div>
              </button>
            </div>
          </div>

          {/* Account section */}
          <div className="mb-10">
            <p className="text-[12px] font-semibold text-[#6B6860] mb-3">Account</p>
            <div className="bg-[#FAFAF7] border border-[#E4E0D9] rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[13px] text-[#6B6860]">
                  Signed in as <span className="text-[#1A1917] font-medium">{user?.email || 'user@email.com'}</span>
                </p>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-medium text-[#E8462A] bg-[#FAE8E5] hover:bg-[#E8462A] hover:text-white transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
