"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ApprovalRequest, ExecutionRun, ExecutionTask, ReusableSkill, ScheduledWorkflow } from "@/lib/shared/types";
import { useApp } from "./OpenCrewBotApp";
import { Button, Drawer, inputClass } from "./ui";

export function OperationsPanel({ onClose }: { onClose: () => void }) {
  const { toast, refresh } = useApp();
  const [instruction, setInstruction] = useState("");
  const [factoryInstruction, setFactoryInstruction] = useState("");
  const [executions, setExecutions] = useState<Array<{ run: ExecutionRun; tasks: ExecutionTask[] }>>([]);
  const [skills, setSkills] = useState<ReusableSkill[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [schedules, setSchedules] = useState<ScheduledWorkflow[]>([]);

  const reload = async () => {
    const [executionData, skillData, approvalData, scheduleData] = await Promise.all([
      api.executions(),
      api.skills(),
      api.approvals(),
      api.schedules(),
    ]);
    setExecutions(executionData.executions);
    setSkills(skillData.skills);
    setApprovals(approvalData.approvals);
    setSchedules(scheduleData.schedules);
  };

  useEffect(() => {
    void reload().catch((error) => toast(error instanceof Error ? error.message : "Couldn't load operations."));
  }, []);

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
