"use client";

import { useState } from "react";
import {
  Search,
  Star,
  Download,
  Grid,
  List,
  ArrowLeft,
  Shapes,
  Heart,
} from "lucide-react";
import Link from "next/link";

interface LibraryItem {
  id: string;
  name: string;
  category: string;
  author: string;
  downloads: number;
  preview: string;
  isFavorite: boolean;
}

const MOCK_LIBRARY: LibraryItem[] = [
  {
    id: "1",
    name: "Flowchart Shapes",
    category: "Diagrams",
    author: "Dripl Team",
    downloads: 12500,
    preview: "/placeholder.svg",
    isFavorite: false,
  },
  {
    id: "2",
    name: "UI Icons Pack",
    category: "Icons",
    author: "Community",
    downloads: 8200,
    preview: "/placeholder.svg",
    isFavorite: true,
  },
  {
    id: "3",
    name: "Architecture Symbols",
    category: "Diagrams",
    author: "Dripl Team",
    downloads: 5600,
    preview: "/placeholder.svg",
    isFavorite: false,
  },
  {
    id: "4",
    name: "Hand-drawn Arrows",
    category: "Shapes",
    author: "Community",
    downloads: 15000,
    preview: "/placeholder.svg",
    isFavorite: true,
  },
];

const CATEGORIES = ["All", "Diagrams", "Icons", "Shapes", "UI Components"];

export default function LibraryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const filteredItems = MOCK_LIBRARY.filter((item) => {
    const matchesSearch = item.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === "All" || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-dvh">
      {/* Header */}
      <header className="border-b border-gray-800 p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-2">
              <ArrowLeft size={16} />
            </Link>
            <div className="flex items-center gap-2">
              <Shapes className="text-purple-500" size={24} />
              <h1 className="text-xl font-bold">Shape Library</h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                size={18}
              />
              <input
                type="text"
                placeholder="Search library..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-purple-500 w-64"
              />
            </div>

            <div className="flex items-center gap-1 bg-gray-900 rounded-lg p-1">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 rounded ${
                  viewMode === "grid" ? "bg-gray-700" : "hover:bg-gray-800"
                }`}
              >
                <Grid size={18} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 rounded ${
                  viewMode === "list" ? "bg-gray-700" : "hover:bg-gray-800"
                }`}
              >
                <List size={18} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-6">
        {/* Categories */}
        <div className="flex gap-2 mb-6">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded-full text-sm transition-colors ${
                selectedCategory === category
                  ? "bg-purple-600"
                  : "bg-gray-800 hover:bg-gray-700"
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Grid/List */}
        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden hover:border-purple-500 transition-colors group"
              >
                <div className="aspect-video bg-gray-800 flex items-center justify-center">
                  <Shapes className="text-gray-600" size={48} />
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-medium">{item.name}</h3>
                    <button className="text-gray-500 hover:text-red-500">
                      <Heart
                        size={18}
                        className={
                          item.isFavorite ? "fill-red-500 text-red-500" : ""
                        }
                      />
                    </button>
                  </div>
                  <p className="text-sm text-gray-400 mb-3">by {item.author}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Download size={14} />
                      {item.downloads.toLocaleString()}
                    </span>
                    <button className="text-sm bg-purple-600 hover:bg-purple-700 px-3 py-1 rounded">
                      Add
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="bg-gray-900 rounded-lg border border-gray-800 p-4 flex items-center justify-between hover:border-purple-500 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="size-12 bg-gray-800 rounded flex items-center justify-center">
                    <Shapes className="text-gray-600" size={24} />
                  </div>
                  <div>
                    <h3 className="font-medium">{item.name}</h3>
                    <p className="text-sm text-gray-400">
                      {item.category} • by {item.author}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-500">
                    {item.downloads.toLocaleString()} downloads
                  </span>
                  <button className="text-sm bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded">
                    Add to Canvas
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
