"use client";

import { useState } from 'react';

export default function TestPage() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <h1 className="text-4xl font-bold mb-8">Button Functionality Test</h1>
      
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Simple Button</h2>
        <button 
          className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          onClick={() => {
            console.log('Simple button clicked');
            alert('Simple button clicked!');
            setCount(count + 1);
          }}
        >
          Click Me ({count})
        </button>
      </div>

      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Button Inside Absolute Container</h2>
        <div className="relative h-40 bg-gray-200 rounded-lg overflow-hidden">
          <button 
            className="absolute top-4 right-4 z-50 px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors"
            onClick={() => {
              console.log('Absolute button clicked');
              alert('Absolute button clicked!');
              setCount(count + 1);
            }}
