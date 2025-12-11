import React from "react";
import Canvas from "./Canvas";

interface RemoteCanvasProps {
  fileId: string;
  initialData: any;
  readOnly: boolean;
  isAuthenticated: boolean;
}

export const RemoteCanvas: React.FC<RemoteCanvasProps> = ({
  fileId,
  initialData,
  readOnly,
  isAuthenticated,
}) => {
  return <Canvas />;
};
