"use client";

import { useEffect, useMemo, useState } from "react";

type Scope = "incident" | "platform";
type PromptRecord = {
  id:string;
  scope:string;
  file:string;
  function:string;
  line:number;
  call:string;
  prompt_type:string;
  template:string;
  active:boolean;
};

function cleanTemplate(value:string){
  // ast.unparse returns quoted Python source expressions. Keep the expression exact,
  // but make long literal prompts easier to read without altering placeholders.
  return value;
}

export default function PromptRegistry({
  scope,
  currentRail,
}:{
  scope:Scope;
  currentRail?:string;
}) {
  const [records,setRecords]=useState<PromptRecord[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [query,setQuery]=useState("");
  const [fileFilter,setFileFilter]=useState("all");

  useEffect(()=>{
    let live=true;
    setLoading(true);
    fetch(`/api/prompts?scope=${scope}`,{cache:"no-store"})
      .then(async r=>{
        const p=await r.json();
        if(!r.ok)throw new Error(p?.detail||"Unable to load prompt registry");
        if(live)setRecords(p.prompts||[]);
      })
      .catch(e=>{if(live)setError(e instanceof Error?e.message:"Unable to load prompt registry");})
      .finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[scope]);

  const files=useMemo(
    ()=>Array.from(new Set(records.map(r=>r.file))).sort(),
    [records]
  );

  const visible=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return records.filter(r=>{
      if(fileFilter!=="all"&&r.file!==fileFilter)return false;
      if(!q)return true;
      return [r.file,r.function,r.call,r.prompt_type,r.template]
        .join(" ").toLowerCase().includes(q);
    });
  },[records,fileFilter,query]);

  return <section className="signal-card p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="text-xs font-semibold tracking-[0.14em] text-violet-300">
          AI PROMPT REGISTRY · READ ONLY
        </div>
        <h2 className="mt-2 text-xl font-semibold">
          Exact active prompt templates
        </h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
          Generated directly from the active backend source at request time. This shows the
          system instructions, runtime/user templates and framework prompt fields that are
          actually wired into the application. Dynamic placeholders remain visible as source
          placeholders so the registry does not invent runtime evidence.
          {scope==="platform"&&currentRail?` Current governance rail: ${currentRail.toUpperCase()}.`:""}
        </p>
      </div>
      <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.05] px-3 py-2 text-xs font-semibold text-emerald-200">
        {loading?"Loading…":`${records.length} active prompt fragments`}
      </div>
    </div>

    <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr]">
      <input
        value={query}
        onChange={e=>setQuery(e.target.value)}
        placeholder="Search agent, prompt text, file or function…"
        className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600"
      />
      <select
        value={fileFilter}
        onChange={e=>setFileFilter(e.target.value)}
        className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
      >
        <option value="all">All prompt sources</option>
        {files.map(file=><option key={file} value={file}>{file}</option>)}
      </select>
    </div>

    {error&&<div className="mt-4 rounded-lg border border-red-300/20 bg-red-300/[0.05] p-3 text-sm text-red-200">{error}</div>}

    <div className="mt-5 grid gap-3">
      {visible.map(item=><details key={item.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-violet-300/20 bg-violet-300/[0.06] px-2 py-1 text-[10px] font-semibold text-violet-200">
                  {item.prompt_type.toUpperCase()}
                </span>
                <span className="text-sm font-semibold text-white">{item.function}</span>
                <span className="text-[10px] text-slate-600">{item.call}</span>
              </div>
              <div className="mt-2 font-mono text-[11px] text-slate-500">
                {item.file}:{item.line}
              </div>
            </div>
            <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.05] px-2 py-1 text-[10px] font-semibold text-emerald-200">
              ACTIVE · {item.id}
            </span>
          </div>
        </summary>

        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="mb-2 text-[10px] font-semibold tracking-[0.12em] text-slate-500">
            EXACT SOURCE TEMPLATE
          </div>
          <pre className="prompt-source-template max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-[#050c12] p-4 font-mono text-xs leading-6">
            {cleanTemplate(item.template)}
          </pre>
        </div>
      </details>)}

      {!loading&&!visible.length&&
        <div className="rounded-xl border border-white/10 bg-black/20 p-8 text-center text-sm text-slate-600">
          No prompt templates match the selected filters.
        </div>
      }
    </div>

    <div className="mt-4 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.035] p-3 text-xs leading-5 text-slate-500">
      Governance note: this registry exposes prompt templates and runtime input templates, not hidden model reasoning or chain-of-thought.
    </div>
  </section>;
}
