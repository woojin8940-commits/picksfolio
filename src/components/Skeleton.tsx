import React from 'react';

export const SkeletonItem: React.FC = () => (
  <div className="bg-white p-4 md:p-6 rounded-[1.5rem] md:rounded-[2rem] border border-[#E2E8F0] flex items-center gap-4 md:gap-6 shadow-sm animate-pulse">
    <div className="w-16 h-16 md:w-24 md:h-24 rounded-xl md:rounded-2xl bg-slate-200 flex-shrink-0"></div>
    <div className="flex-1 space-y-3">
      <div className="h-3 w-12 bg-slate-100 rounded-md"></div>
      <div className="h-5 w-3/4 bg-slate-200 rounded-lg"></div>
      <div className="h-3 w-20 bg-slate-100 rounded-md"></div>
    </div>
    <div className="w-5 h-5 bg-slate-100 rounded-full"></div>
  </div>
);

export const SkeletonGrid: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="space-y-3 md:space-y-4">
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonItem key={i} />
    ))}
  </div>
);

export const SkeletonDesign: React.FC = () => (
  <div className="space-y-12 animate-pulse">
    <div className="flex justify-end">
      <div className="w-32 h-12 bg-slate-200 rounded-2xl"></div>
    </div>
    <section className="space-y-6">
      <div className="w-48 h-6 bg-slate-200 rounded-lg"></div>
      <div className="h-40 bg-white border border-slate-100 rounded-[2rem]"></div>
    </section>
    <section className="space-y-6">
      <div className="w-48 h-6 bg-slate-200 rounded-lg"></div>
      <div className="grid grid-cols-2 gap-6">
        <div className="h-40 bg-white border border-slate-100 rounded-[2rem]"></div>
        <div className="h-40 bg-white border border-slate-100 rounded-[2rem]"></div>
      </div>
    </section>
  </div>
);
