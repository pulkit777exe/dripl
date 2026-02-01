"use client";

import { useState } from "react";
import {
  Search,
  ArrowLeft,
  FileText,
  Users,
  Briefcase,
  Lightbulb,
  Layout,
} from "lucide-react";
import Link from "next/link";

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  preview: string;
}

const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "Blank Canvas",
    description: "Start with a clean slate",
    category: "Basic",
    preview: "/placeholder.svg",
  },
  {
    id: "flowchart",
    name: "Flowchart",
    description: "Process flows and decision trees",
    category: "Diagrams",
    preview: "/placeholder.svg",
  },
  {
    id: "wireframe",
    name: "Wireframe",
    description: "UI/UX wireframing with common components",
    category: "Design",
    preview: "/placeholder.svg",
  },
  {
    id: "mindmap",
    name: "Mind Map",
    description: "Brainstorming and idea organization",
    category: "Planning",
    preview: "/placeholder.svg",
  },
  {
    id: "kanban",
    name: "Kanban Board",
    description: "Task management and workflow",
    category: "Planning",
    preview: "/placeholder.svg",
  },
  {
    id: "retrospective",
    name: "Retrospective",
    description: "Team retrospective template",
    category: "Meetings",
    preview: "/placeholder.svg",
  },
  {
    id: "user-story",
    name: "User Story Map",
    description: "Map out user journeys and stories",
    category: "Planning",
    preview: "/placeholder.svg",
  },
  {
    id: "architecture",
    name: "System Architecture",
    description: "Technical architecture diagrams",
    category: "Diagrams",
    preview: "/placeholder.svg",
  },
];

const CATEGORIES = [
  { id: "all", label: "All", icon: Layout },
  { id: "basic", label: "Basic", icon: FileText },
  { id: "diagrams", label: "Diagrams", icon: Lightbulb },
  { id: "design", label: "Design", icon: Layout },
  { id: "planning", label: "Planning", icon: Briefcase },
  { id: "meetings", label: "Meetings", icon: Users },
];

export default function TemplatesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  const filteredTemplates = TEMPLATES.filter((template) => {
    const matchesSearch =
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === "all" ||
      template.category.toLowerCase() === selectedCategory.toLowerCase();
    return matchesSearch && matchesCategory;
  });

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
            <h1 className="text-xl font-bold">Templates</h1>
          </div>

          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
              size={18}
            />
            <input
              type="text"
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-purple-500 w-64"
            />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-6">
        {/* Categories */}
        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          {CATEGORIES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSelectedCategory(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
                selectedCategory === id
                  ? "bg-purple-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>

        {/* Templates Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredTemplates.map((template) => (
            <Link
              key={template.id}
              href={`/canvas?template=${template.id}`}
              className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden hover:border-purple-500 transition-all hover:scale-[1.02] group"
            >
              <div className="aspect-video bg-gray-800 flex items-center justify-center">
                <FileText className="text-gray-600" size={48} />
              </div>
              <div className="p-4">
                <h3 className="font-medium mb-1 group-hover:text-purple-400 transition-colors">
                  {template.name}
                </h3>
                <p className="text-sm text-gray-400">{template.description}</p>
                <span className="inline-block mt-3 text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded">
                  {template.category}
                </span>
              </div>
            </Link>
          ))}
        </div>

        {filteredTemplates.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-400">
              No templates found matching your search.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
