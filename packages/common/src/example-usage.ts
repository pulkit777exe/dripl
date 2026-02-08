import { Scene } from "./scene";
import { ActionCreator, ActionReducer, ActionDispatcher } from "./actions";
import { DeltaManager, SceneHistory } from "./delta";
import { PointerManager, DragDetector } from "./pointer";
import { createElement } from "@dripl/element";
import { SHAPES } from "./constants";

// Example usage of the new architecture
function exampleUsage() {
  console.log("=== Dripl Architecture Example ===");

  // 1. Create a new scene
  const initialElements = [
    createElement(SHAPES.RECTANGLE, 100, 100, 200, 150),
    createElement(SHAPES.ELLIPSE, 400, 100, 150, 150),
    createElement(SHAPES.TEXT, 100, 300, 200, 50),
  ];

  const scene = new Scene(initialElements);
  console.log("Initial scene elements:", scene.getElements().length);

  // 2. Initialize action system
  const actionDispatcher = new ActionDispatcher();
  const deltaManager = new DeltaManager();
  const sceneHistory = new SceneHistory(scene);

  // 3. Subscribe to action updates
  actionDispatcher.subscribe((action) => {
    console.log("Action dispatched:", action.type);
    const newScene = ActionReducer.reduce(scene, action, deltaManager);
    sceneHistory.pushState(newScene, deltaManager.getDeltas().pop());
  });

  // 4. Dispatch actions
  console.log("\n--- Dispatching Actions ---");

  // Add a new element
  const newElement = createElement(SHAPES.DIAMOND, 250, 400, 100, 100);
  actionDispatcher.dispatch(ActionCreator.addElement(newElement));
  console.log(
    "After adding element:",
    sceneHistory.getCurrentState()?.getElements().length,
  );

  // Select an element
  const firstElementId = scene.getElements()[0].id;
  actionDispatcher.dispatch(ActionCreator.selectElement(firstElementId));
  console.log(
    "Selected elements:",
    sceneHistory.getCurrentState()?.getSelectedElements().length,
  );

  // Update an element
  const updates = { strokeColor: "#ff0000", strokeWidth: 3 };
  actionDispatcher.dispatch(
    ActionCreator.updateElement(firstElementId, updates),
  );
  console.log(
    "Element updated:",
    sceneHistory.getCurrentState()?.getElement(firstElementId),
  );

  // 5. Use history system
  console.log("\n--- History System ---");
  console.log("Can undo:", sceneHistory.canUndo());
  const previousState = sceneHistory.undo();
  console.log("After undo:", previousState?.getElements().length);

  console.log("Can redo:", sceneHistory.canRedo());
  const nextState = sceneHistory.redo();
  console.log("After redo:", nextState?.getElements().length);

  // 6. Check delta system
  console.log("\n--- Delta System ---");
  const deltas = deltaManager.getDeltas();
  console.log("Total deltas:", deltas.length);
  deltas.forEach((delta, index) => {
    console.log(`Delta ${index + 1}:`, delta.operation, delta.elementId);
  });

  // 7. Pointer interaction simulation
  console.log("\n--- Pointer Interaction ---");

  // In a real app, we'd pass a DOM container
  // const container = document.getElementById('canvas-container');
  // const pointerManager = new PointerManager(container);

  const pointerManager = new PointerManager(null);
  const dragDetector = new DragDetector(pointerManager);

  console.log("Active pointers:", pointerManager.getActivePointerCount());
  console.log("Is dragging:", dragDetector.isDraggingState());

  console.log("\n=== Example Complete ===");
}

// Run the example
if (require.main === module) {
  exampleUsage();
}

export { exampleUsage };
