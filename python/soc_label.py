import argparse
import base64
import io
import json
import os
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    try:
        from PIL import Image, ImageDraw
        from ultralytics import YOLO
    except Exception as exc:
        write_json(args.output, {"error": f"missing_python_dependency:{exc}"})
        return 1

    try:
        payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
        screenshot_base64 = payload["screenshot_base64"]
        image = Image.open(io.BytesIO(base64.b64decode(screenshot_base64))).convert("RGB")
        model_path = os.environ.get("SOC_YOLO_MODEL") or str(Path("python") / "best.pt")
        if not Path(model_path).exists():
            write_json(args.output, {"error": f"missing_yolo_model:{model_path}"})
            return 1

        model = YOLO(model_path)
        results = model(image)
        draw = ImageDraw.Draw(image)
        label_coordinates = {}
        drawn_boxes = []
        counter = 1

        for result in results:
            boxes = getattr(result, "boxes", None)
            if boxes is None:
                continue
            for det in boxes:
                x1, y1, x2, y2 = [float(v) for v in det.xyxy[0].tolist()]
                box = (x1, y1, x2, y2)
                if any(overlaps(box, previous) for previous in drawn_boxes):
                    continue
                label = f"~{counter}"
                drawn_boxes.append(box)
                label_coordinates[label] = [round(x1), round(y1), round(x2), round(y2)]
                draw.rectangle([(x1, y1), (x2, y2)], outline="red", width=2)
                draw.rectangle([(x1, max(0, y1 - 24)), (x1 + 48, max(20, y1))], fill="red")
                draw.text((x1 + 4, max(0, y1 - 22)), label, fill="white")
                counter += 1

        output = io.BytesIO()
        image.save(output, format="JPEG", quality=86)
        write_json(args.output, {
            "labeled_screenshot_base64": base64.b64encode(output.getvalue()).decode("utf-8"),
            "label_coordinates": label_coordinates,
        })
        return 0
    except Exception as exc:
        write_json(args.output, {"error": str(exc)})
        return 1


def overlaps(a, b) -> bool:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    return not (ax1 > bx2 or bx1 > ax2 or ay1 > by2 or by1 > ay2)


def write_json(path: str, value: dict) -> None:
    Path(path).write_text(json.dumps(value), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
