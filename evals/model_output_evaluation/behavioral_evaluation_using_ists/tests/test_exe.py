"""
Test suite for classify_behavior.exe

This script tests the standalone executable to ensure it works correctly
after being built with PyInstaller.

Usage:
    python test_exe.py                    # Run all tests
    python test_exe.py --exe path/to/exe  # Specify exe path
    python test_exe.py --verbose          # Show detailed output
"""

import subprocess
import sys
import os
import json
import tempfile
import shutil
import argparse
from pathlib import Path

import numpy as np


class ExeTestRunner:
    """Test runner for classify_behavior executable."""
    
    def __init__(self, exe_path: str = None, verbose: bool = False):
        """
        Initialize the test runner.
        
        Args:
            exe_path: Path to the executable (default: auto-detect)
            verbose: Whether to show detailed output
        """
        self.verbose = verbose
        self.exe_path = self._find_exe(exe_path)
        self.temp_dir = None
        self.passed = 0
        self.failed = 0
        self.errors = []
    
    def _find_exe(self, exe_path: str = None) -> Path:
        """Find the executable path."""
        if exe_path:
            path = Path(exe_path)
            if path.exists():
                return path
            raise FileNotFoundError(f"Executable not found: {exe_path}")
        
        # Auto-detect in common locations
        script_dir = Path(__file__).parent.resolve()
        possible_paths = [
            script_dir / 'dist' / 'classify_behavior.exe',
            script_dir / 'dist' / 'classify_behavior' / 'classify_behavior.exe',
            script_dir / 'classify_behavior.exe',
            script_dir.parent / 'dist' / 'classify_behavior.exe',
            script_dir.parent / 'dist_examples' / 'classify_behavior.exe',
        ]
        
        for path in possible_paths:
            if path.exists():
                return path
        
        raise FileNotFoundError(
            "Could not find classify_behavior.exe. "
            "Run 'python build.py' first or specify path with --exe"
        )
    
    def setup(self):
        """Set up test environment."""
        self.temp_dir = tempfile.mkdtemp(prefix="classify_behavior_test_")
        if self.verbose:
            print(f"Created temp directory: {self.temp_dir}")
    
    def teardown(self):
        """Clean up test environment."""
        if self.temp_dir and os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
            if self.verbose:
                print(f"Removed temp directory: {self.temp_dir}")
    
    def run_exe(self, *args, capture_output=True) -> subprocess.CompletedProcess:
        """Run the executable with given arguments."""
        cmd = [str(self.exe_path)] + list(args)
        if self.verbose:
            print(f"  Command: {' '.join(cmd)}")
        
        result = subprocess.run(
            cmd,
            capture_output=capture_output,
            text=True,
            timeout=60  # 60 second timeout
        )
        
        if self.verbose and result.stdout:
            print(f"  Output: {result.stdout[:200]}...")
        
        return result
    
    def create_test_csv(self, name: str, data: np.ndarray) -> str:
        """Create a test CSV file with given data."""
        path = os.path.join(self.temp_dir, name)
        with open(path, 'w') as f:
            f.write("value\n")
            for v in data:
                f.write(f"{v}\n")
        return path
    
    def create_test_json(self, name: str, data: np.ndarray) -> str:
        """Create a test JSON file with given data."""
        path = os.path.join(self.temp_dir, name)
        with open(path, 'w') as f:
            json.dump(data.tolist(), f)
        return path
    
    def test(self, name: str, condition: bool, message: str = ""):
        """Record a test result."""
        if condition:
            self.passed += 1
            status = "✓ PASS"
        else:
            self.failed += 1
            status = "✗ FAIL"
            self.errors.append(f"{name}: {message}")
        
        print(f"  {status}: {name}")
        if not condition and message:
            print(f"         {message}")
    
    def run_all_tests(self):
        """Run all tests."""
        print("=" * 60)
        print(f"Testing: {self.exe_path}")
        print("=" * 60)
        print()
        
        self.setup()
        
        try:
            self.test_help()
            self.test_version()
            self.test_list_patterns()
            self.test_classify_csv()
            self.test_classify_json()
            self.test_json_output()
            self.test_hypothesis()
            self.test_invalid_input()
            self.test_missing_file()
        finally:
            self.teardown()
        
        print()
        print("=" * 60)
        print(f"Results: {self.passed} passed, {self.failed} failed")
        print("=" * 60)
        
        if self.errors:
            print("\nErrors:")
            for error in self.errors:
                print(f"  - {error}")
        
        return self.failed == 0
    
    def test_help(self):
        """Test --help flag."""
        print("\nTest: --help")
        result = self.run_exe("--help")
        self.test("returns exit code 0", result.returncode == 0)
        self.test("shows usage info", "usage:" in result.stdout.lower() or "classify" in result.stdout.lower())
    
    def test_version(self):
        """Test --version flag."""
        print("\nTest: --version")
        result = self.run_exe("--version")
        self.test("returns exit code 0", result.returncode == 0)
        self.test("shows version", "1.0" in result.stdout or "version" in result.stdout.lower())
    
    def test_list_patterns(self):
        """Test --list-patterns flag."""
        print("\nTest: --list-patterns")
        result = self.run_exe("--list-patterns")
        self.test("returns exit code 0", result.returncode == 0)
        self.test("shows pattern codes", "plinr" in result.stdout and "oscct" in result.stdout)
        self.test("shows 25 patterns", "24" in result.stdout)  # Last ID is 24
    
    def test_classify_csv(self):
        """Test classifying a CSV file."""
        print("\nTest: Classify CSV")
        
        # Create linear growth data
        np.random.seed(42)
        t = np.linspace(0, 10, 100)
        data = 2 * t + 5 + np.random.normal(0, 0.5, len(t))
        csv_path = self.create_test_csv("linear.csv", data)
        
        result = self.run_exe(csv_path)
        self.test("returns exit code 0", result.returncode == 0)
        self.test("identifies linear pattern", "plinr" in result.stdout)
    
    def test_classify_json(self):
        """Test classifying a JSON file."""
        print("\nTest: Classify JSON")
        
        # Create oscillation data
        np.random.seed(42)
        t = np.linspace(0, 10, 100)
        data = 50 + 20 * np.sin(2 * np.pi * 0.5 * t) + np.random.normal(0, 1, len(t))
        json_path = self.create_test_json("oscillation.json", data)
        
        result = self.run_exe(json_path)
        self.test("returns exit code 0", result.returncode == 0)
        self.test("identifies oscillation pattern", "oscct" in result.stdout)
    
    def test_json_output(self):
        """Test JSON output format."""
        print("\nTest: JSON output format")
        
        np.random.seed(42)
        t = np.linspace(0, 10, 100)
        data = 5 * np.exp(0.3 * t) + np.random.normal(0, 2, len(t))
        csv_path = self.create_test_csv("exp_growth.csv", data)
        
        result = self.run_exe(csv_path, "--format", "json")
        self.test("returns exit code 0", result.returncode == 0)
        
        try:
            parsed = json.loads(result.stdout)
            self.test("output is valid JSON", True)
            self.test("has class_name field", "class_name" in parsed)
            self.test("has class_id field", "class_id" in parsed)
            self.test("identifies exponential growth", parsed.get("class_name") == "pexgr")
        except json.JSONDecodeError as e:
            self.test("output is valid JSON", False, str(e))
    
    def test_hypothesis(self):
        """Test hypothesis testing."""
        print("\nTest: Hypothesis testing")
        
        np.random.seed(42)
        t = np.linspace(0, 10, 100)
        data = 25 + np.random.normal(0, 0.5, len(t))  # Constant/stasis
        csv_path = self.create_test_csv("stasis.csv", data)
        
        # Test correct hypothesis
        result = self.run_exe(csv_path, "--hypothesis", "const")
        self.test("correct hypothesis returns 0", result.returncode == 0)
        self.test("confirms correct hypothesis", "CONFIRMED" in result.stdout.upper())
        
        # Test incorrect hypothesis
        result = self.run_exe(csv_path, "--hypothesis", "pexgr")
        self.test("incorrect hypothesis returns 0", result.returncode == 0)
        self.test("rejects incorrect hypothesis", "REJECTED" in result.stdout.upper())
    
    def test_invalid_input(self):
        """Test handling of invalid input."""
        print("\nTest: Invalid input handling")
        
        # Create file with non-numeric data
        bad_path = os.path.join(self.temp_dir, "bad_data.csv")
        with open(bad_path, 'w') as f:
            f.write("value\n")
            f.write("not a number\n")
            f.write("also not a number\n")
        
        result = self.run_exe(bad_path)
        self.test("handles invalid data gracefully", result.returncode != 0 or "error" in result.stdout.lower() or "error" in result.stderr.lower())
    
    def test_missing_file(self):
        """Test handling of missing file."""
        print("\nTest: Missing file handling")
        
        result = self.run_exe("nonexistent_file.csv")
        self.test("returns non-zero for missing file", result.returncode != 0)
        self.test("shows error message", "error" in result.stderr.lower() or "not found" in result.stderr.lower())


def main():
    parser = argparse.ArgumentParser(description="Test classify_behavior executable")
    parser.add_argument("--exe", help="Path to the executable")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show detailed output")
    
    args = parser.parse_args()
    
    try:
        runner = ExeTestRunner(exe_path=args.exe, verbose=args.verbose)
        success = runner.run_all_tests()
        return 0 if success else 1
    except FileNotFoundError as e:
        print(f"Error: {e}")
        return 1
    except Exception as e:
        print(f"Unexpected error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
