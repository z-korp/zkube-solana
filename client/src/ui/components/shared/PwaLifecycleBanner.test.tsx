import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PwaLifecycleNotice } from "./PwaLifecycleBanner";

describe("PwaLifecycleNotice", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());

  it("gives retry guidance without claiming cached chain data is available", () => {
    render(
      <PwaLifecycleNotice
        lifecycle={{ online: false, update: "idle" }}
        refreshBlocked={false}
        onRefresh={() => true}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /reconnect, then retry/i,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /never served from the offline cache/i,
    );
    expect(
      screen.queryByRole("button", { name: "Refresh" }),
    ).not.toBeInTheDocument();
  });

  it("activates a waiting update only after the refresh action", () => {
    const onRefresh = vi.fn(() => true);
    render(
      <PwaLifecycleNotice
        lifecycle={{ online: true, update: "available" }}
        refreshBlocked={false}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText(/new zkube version is ready/i)).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("blocks a refresh while the play surface is active", () => {
    const onRefresh = vi.fn(() => true);
    render(
      <PwaLifecycleNotice
        lifecycle={{ online: true, update: "available" }}
        refreshBlocked
        onRefresh={onRefresh}
      />,
    );

    expect(
      screen.getByText(/finish or leave active play/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("returns a timed-out activation to a retry action", () => {
    const onRefresh = vi.fn(() => true);
    render(
      <PwaLifecycleNotice
        lifecycle={{ online: true, update: "activation-failed" }}
        refreshBlocked={false}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText(/update did not activate/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry refresh/i }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
