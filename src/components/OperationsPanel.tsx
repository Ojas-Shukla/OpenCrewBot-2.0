"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ApprovalRequest, CollaborationRecord, ExecutionRun, ExecutionTask, ReusableSkill, ScheduledWorkflow } from "@/lib/shared/types";
import { useApp } from "./OpenCrewBotApp";
import { Button, Drawer, inputClass } from "./ui";

export function OperationsPanel({ onClose }: { onClose: () => void }) {
  const { state, toast, refresh } = useApp();
  const [instruction, setInstruction] = useState("");
  const [factoryInstruction, setFactoryInstruction] = useState("");
  const [executions, setExecutions] = useState<Array<{ run: ExecutionRun; tasks: ExecutionTask[] }>>([]);
  const [skills, setSkills] = useState<ReusableSkill[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [schedules, setSchedules] = useState<ScheduledWorkflow[]>([]);
  const [collaboration, setCollaboration] = useState<CollaborationRecord[]>([]);
  const [memoryScope, setMemoryScope] = useState<"room" | "project" | "user">("project");
  const [memoryOwner, setMemoryOwner] = useState("default");
  const [memoryContent, setMemoryContent] = useState("");
  const [workflowName, setWorkflowName] = useState("");
  const [workflowInstruction, setWorkflowInstruction] = useState("");

  const reload = async () => {
    const [executionData, skillData, approvalData, scheduleData, collaborationData] = await Promise.all([
      api.executions(),
      api.skills(),
      api.approvals(),
      api.schedules(),
      api.collaboration(),
    ]);
    setExecutions(executionData.executions);
    setSkills(skillData.skills);
    setApprovals(approvalData.approvals);
    setSchedules(scheduleData.schedules);
    setCollaboration(collaborationData.records);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refreshes external API state once on open
    void reload().catch((error) => toast(error instanceof Error ? error.message : "Couldn't load operations."));
  }, [toast]);

  const plan = async (execute: boolean) => {
    if (!instruction.trim()) return;
    try {
      await api.chiefOfStaff(instruction, execute);
      await reload();
      toast(execute ? "Chief of Staff started the workforce." : "Execution plan created.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't create a plan.");
    }
  };

  const createAgent = async () => {
    if (!factoryInstruction.trim()) return;
    try {
      await api.factory(factoryInstruction);
      await refresh();
      setFactoryInstruction("");
      toast("Agent created and available for assignments.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't create the agent.");
    }
  };

  const resolve = async (id: string, resolution: "allow_once" | "reject") => {
    await api.resolveApproval(id, resolution);
    await reload();
  };

  const loadMemory = async () => {
    try {
      const result = await api.sharedMemory(memoryScope, memoryOwner);
      setMemoryContent(result.content);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't load shared memory.");
    }
  };

  const saveMemory = async () => {
    try {
      await api.saveSharedMemory(memoryScope, memoryOwner, memoryContent, "Edited from Workforce operations");
      toast("Shared memory saved.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't save shared memory.");
    }
  };

  const createWorkflow = async () => {
    if (!workflowName.trim() || !workflowInstruction.trim() || !state.bots.length) return;
    try {
      const botId = state.bots[0].id;
      await api.createWorkflow({
        name: workflowName,
        description: "Reusable workforce workflow",
        instruction: workflowInstruction,
        taskTemplates: [
          { key: "analyse", title: "Analyse objective", description: workflowInstruction, assignedBotId: botId },
          { key: "complete", title: "Complete objective", description: "Complete the objective using the available evidence and tools.", assignedBotId: botId, dependencies: ["analyse"] },
          { key: "consolidate", title: "Consolidate output", description: "Combine findings into one final report.", assignedBotId: botId, dependencies: ["complete"] },
        ],
      });
      setWorkflowName("");
      setWorkflowInstruction("");
      toast("Workflow template created.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't create workflow.");
    }
  };

  return (
    <Drawer title="Workforce operations" onClose={onClose}>
      <section>
        <h3 className="text-[12.5px] font-medium text-mute">Chief of Staff</h3>
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} className={`${inputClass} mt-2 min-h-28 resize-y`} placeholder="Describe a complex business objective…" />
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => void plan(false)}>Create plan</Button>
          <Button size="sm" variant="primary" onClick={() => void plan(true)}>Run workforce</Button>
        </div>
      </section>

      <section className="mt-7">
        <h3 className="text-[12.5px] font-medium text-mute">Dynamic agent factory</h3>
        <textarea value={factoryInstruction} onChange={(event) => setFactoryInstruction(event.target.value)} className={`${inputClass} mt-2 min-h-20 resize-y`} placeholder="Describe the agent, capabilities and expected output…" />
        <Button className="mt-2" size="sm" onClick={() => void createAgent()}>Create agent</Button>
      </section>

      <section className="mt-7">
        <h3 className="text-[12.5px] font-medium text-mute">Execution history</h3>
        <div className="mt-2 space-y-2">
          {executions.map(({ run, tasks }) => (
            <div key={run.id} className="rounded-2xl bg-raised p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-medium">{run.name}</span>
                <span className="text-[12px] text-mute">{run.status}</span>
              </div>
              <p className="mt-1 text-[12px] text-mute">{tasks.filter((task) => task.status === "completed").length}/{tasks.length} tasks completed</p>
              <div className="mt-2 space-y-1">
                {tasks.map((task) => (
                  <div key={task.id} className="rounded-xl bg-raised-2 px-2.5 py-2">
                    <div className="flex justify-between gap-2 text-[12.5px]"><span>{task.title}</span><span className="text-mute">{task.status}</span></div>
                    {task.output && <p className="mt-1 line-clamp-3 text-[12px] text-mute">{task.output}</p>}
                    {task.error && <p className="mt-1 text-[12px] text-danger">{task.error}</p>}
                  </div>
                ))}
              </div>
              {run.status === "running" && <Button className="mt-2" size="sm" variant="danger" onClick={() => void api.cancelExecution(run.id).then(reload)}>Cancel</Button>}
            </div>
          ))}
          {!executions.length && <p className="text-[13px] text-mute">No executions yet.</p>}
        </div>
      </section>

      <section className="mt-7">
        <h3 className="text-[12.5px] font-medium text-mute">Approval centre</h3>
        <div className="mt-2 space-y-2">
          {approvals.filter((item) => item.status === "pending").map((item) => (
            <div key={item.id} className="rounded-2xl bg-raised p-3">
              <p className="text-[13.5px] font-medium">{item.action}</p>
              <p className="mt-1 text-[12.5px] text-mute">{item.preview}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" onClick={() => void resolve(item.id, "allow_once")}>Allow once</Button>
                <Button size="sm" variant="danger" onClick={() => void resolve(item.id, "reject")}>Reject</Button>
              </div>
            </div>
          ))}
          {!approvals.some((item) => item.status === "pending") && <p className="text-[13px] text-mute">No pending approvals.</p>}
          {approvals.filter((item) => item.status !== "pending").slice(0, 10).map((item) => (
            <p key={item.id} className="rounded-xl bg-raised px-3 py-2 text-[12px] text-mute">{item.action}: {item.status}</p>
          ))}
        </div>
      </section>

      <section className="mt-7">
        <h3 className="text-[12.5px] font-medium text-mute">Shared memory</h3>
        <div className="mt-2 flex gap-2">
          <select value={memoryScope} onChange={(event) => setMemoryScope(event.target.value as "room" | "project" | "user")} className={`${inputClass} flex-1`}>
            <option value="project">Project</option>
            <option value="room">Room</option>
            <option value="user">User</option>
          </select>
          <input value={memoryOwner} onChange={(event) => setMemoryOwner(event.target.value)} className={`${inputClass} flex-1`} placeholder="Owner or ID" />
        </div>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => void loadMemory()}>Load</Button>
          <Button size="sm" variant="primary" onClick={() => void saveMemory()}>Save</Button>
        </div>
        <textarea value={memoryContent} onChange={(event) => setMemoryContent(event.target.value)} className={`${inputClass} mt-2 min-h-28 resize-y`} placeholder="Markdown memory…" />
      </section>

      <section className="mt-7">
        <h3 className="text-[12.5px] font-medium text-mute">Collaboration records</h3>
        <div className="mt-2 space-y-2">
          {collaboration.slice(0, 20).map((record) => (
            <div key={record.id} className="rounded-2xl bg-raised p-3">
              <p className="text-[12.5px] font-medium">{record.type} · {record.status}</p>
              <p className="mt-1 text-[12px] text-mute">{record.content}</p>
            </div>
          ))}
          {!collaboration.length && <p className="text-[13px] text-mute">No structured collaboration records yet.</p>}
        </div>
      </section>

      <section className="mt-7">
        <h3 className="text-[12.5px] font-medium text-mute">Skills</h3>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {skills.map((skill) => <div key={skill.id} className="rounded-2xl bg-raised p-3"><p className="text-[13.5px] font-medium">{skill.name}</p><p className="mt-1 text-[12px] text-mute">{skill.category}</p></div>)}
        </div>
      </section>

      <section className="mt-7">
        <h3 className="text-[12.5px] font-medium text-mute">Scheduled workflows</h3>
        <input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} className={`${inputClass} mt-2`} placeholder="Workflow name" />
        <textarea value={workflowInstruction} onChange={(event) => setWorkflowInstruction(event.target.value)} className={`${inputClass} mt-2 min-h-20 resize-y`} placeholder="Recurring objective…" />
        <Button className="mt-2" size="sm" onClick={() => void createWorkflow()}>Create workflow template</Button>
        <div className="mt-2 space-y-2">
          {schedules.map((schedule) => (
            <div key={schedule.id} className="flex items-center justify-between rounded-2xl bg-raised p-3">
              <div><p className="text-[13.5px] font-medium">{schedule.name}</p><p className="text-[12px] text-mute">{schedule.status} · {schedule.cron}</p></div>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => void api.setScheduleStatus(schedule.id, schedule.status === "active" ? "paused" : "active").then(reload)}>Toggle</Button>
                <Button size="sm" variant="primary" onClick={() => void api.runSchedule(schedule.id).then(reload)}>Run</Button>
              </div>
            </div>
          ))}
          {!schedules.length && <p className="text-[13px] text-mute">No schedules yet.</p>}
        </div>
      </section>
    </Drawer>
  );
}
