#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <initializer_list>
#include <yoga/Yoga.h>
#include <yoga/node/Node.h>

using namespace facebook::yoga;

// Fabric's YogaLayoutableShadowNode::updateYogaProps copies styles and marks
// the node dirty without clearing the inherited computedFlexBasis. The public
// YGNodeStyleSetFlex setter clears that cache and would hide this regression.
void updateFlexLikeFabric(YGNodeRef reference, float flex) {
  auto* node = resolveRef(reference);
  auto style = node->style();
  style.setFlex(FloatOptional(flex));
  if (!node->isDirty() && style != node->style()) node->setDirty(true);
  node->setStyle(style);
}

bool check(bool vertical, bool firstArrives, float intrinsic, const char* basis) {
  constexpr float extent = 1212;
  auto config = YGConfigNew();
  auto root = YGNodeNewWithConfig(config);
  YGNodeStyleSetWidth(root, vertical ? 700 : extent);
  YGNodeStyleSetHeight(root, vertical ? extent : 700);
  YGNodeStyleSetFlexDirection(root, vertical ? YGFlexDirectionColumn : YGFlexDirectionRow);
  auto first = YGNodeNewWithConfig(config);
  auto second = YGNodeNewWithConfig(config);
  for (auto pane : {first, second}) {
    if (std::strcmp(basis, "auto") != 0) YGNodeStyleSetFlexBasis(pane, std::strtof(basis, nullptr));
    auto content = YGNodeNewWithConfig(config);
    YGNodeStyleSetWidth(content, intrinsic);
    YGNodeStyleSetHeight(content, intrinsic);
    YGNodeInsertChild(pane, content, 0);
  }
  YGNodeStyleSetFlex(first, firstArrives ? 0 : 1);
  YGNodeStyleSetFlex(second, firstArrives ? 1 : 0);
  YGNodeInsertChild(root, first, 0);
  YGNodeInsertChild(root, second, 1);
  YGNodeCalculateLayout(root, YGUndefined, YGUndefined, YGDirectionLTR);
  bool passed = true;
  for (float ratio : {0.8f, 0.6f, 0.5f, 0.25f, 0.75f}) {
    updateFlexLikeFabric(first, ratio);
    updateFlexLikeFabric(second, 1 - ratio);
    resolveRef(root)->setDirty(true);
    YGNodeCalculateLayout(root, YGUndefined, YGUndefined, YGDirectionLTR);
    const float actual = vertical ? YGNodeLayoutGetHeight(first) : YGNodeLayoutGetWidth(first);
    if (std::abs(actual - extent * ratio) > 1) {
      std::printf("FAIL axis=%s incoming=%s intrinsic=%.0f ratio=%.2f first=%.0f expected=%.0f\n",
                  vertical ? "vertical" : "horizontal", firstArrives ? "first" : "second",
                  intrinsic, ratio, actual, extent * ratio);
      passed = false;
    }
  }
  YGNodeFreeRecursive(root);
  YGConfigFree(config);
  return passed;
}

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  bool passed = true;
  for (bool vertical : {false, true})
    for (bool firstArrives : {false, true})
      for (float intrinsic : {0.0f, 30.0f, 56.0f, 120.0f})
        passed = check(vertical, firstArrives, intrinsic, argv[1]) && passed;
  if (passed) std::puts("PASS 80 pane-share checks using the actual app style and installed Yoga");
  return passed ? 0 : 1;
}
