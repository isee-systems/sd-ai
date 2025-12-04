"""
Unit tests for the classify_behavior module.

Run tests with:
    python -m pytest test_classify_behavior.py -v
    
Or directly:
    python test_classify_behavior.py
"""

import sys
import os
import unittest
import json
import tempfile
from pathlib import Path

import numpy as np

# Add src directory to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from classify_behavior import (
    BehaviorClassifier,
    ClassificationResult,
    PATTERN_DESCRIPTIONS,
    load_csv_data,
    load_json_data,
    format_output
)


class TestBehaviorClassifier(unittest.TestCase):
    """Test cases for the BehaviorClassifier class."""
    
    @classmethod
    def setUpClass(cls):
        """Set up classifier instance once for all tests."""
        cls.classifier = BehaviorClassifier()
        
        # Create synthetic test data
        np.random.seed(42)
        t = np.linspace(0, 10, 100)
        
        cls.test_data = {
            'linear_growth': 2 * t + 5 + np.random.normal(0, 0.5, len(t)),
            'exponential_growth': 5 * np.exp(0.3 * t) + np.random.normal(0, 2, len(t)),
            'exponential_decay': 100 * np.exp(-0.4 * t) + np.random.normal(0, 1, len(t)),
            's_curve': 100 / (1 + np.exp(-0.8 * (t - 5))) + np.random.normal(0, 2, len(t)),
            'oscillation': 50 + 20 * np.sin(2 * np.pi * 0.5 * t) + np.random.normal(0, 1, len(t)),
            'stasis': 25 + np.random.normal(0, 0.5, len(t))
        }
    
    def test_classifier_initialization(self):
        """Test that classifier initializes correctly."""
        self.assertIsNotNone(self.classifier)
        self.assertEqual(len(self.classifier.pattern_codes), 25)
        self.assertEqual(len(self.classifier.pattern_descriptions), 25)
    
    def test_pattern_codes(self):
        """Test that all expected pattern codes are present."""
        codes = self.classifier.pattern_codes
        expected_codes = ['zero0', 'const', 'plinr', 'nlinr', 'nexgr',
                         'sshgr', 'pexgr', 'gr1da', 'gr1db', 'gr2da',
                         'gr2db', 'd1peg', 'd2peg', 'nexdc', 'sshdc',
                         'pexdc', 'd1gra', 'd1grb', 'd2gra', 'd2grb',
                         'g1ped', 'g2ped', 'oscct', 'oscgr', 'oscdc']
        self.assertEqual(codes, expected_codes)
    
    def test_classify_linear_growth(self):
        """Test classification of linear growth pattern."""
        result = self.classifier.classify(self.test_data['linear_growth'])
        self.assertIsInstance(result, ClassificationResult)
        self.assertEqual(result.class_name, 'plinr')  # Positive linear
        # Note: is_weak_match may vary with synthetic data
    
    def test_classify_exponential_growth(self):
        """Test classification of exponential growth pattern."""
        result = self.classifier.classify(self.test_data['exponential_growth'])
        self.assertEqual(result.class_name, 'pexgr')  # Positive exponential growth
    
    def test_classify_exponential_decay(self):
        """Test classification of exponential decay pattern."""
        result = self.classifier.classify(self.test_data['exponential_decay'])
        self.assertEqual(result.class_name, 'nexdc')  # Negative exponential decay
    
    def test_classify_s_curve(self):
        """Test classification of S-curve pattern."""
        result = self.classifier.classify(self.test_data['s_curve'])
        self.assertEqual(result.class_name, 'sshgr')  # S-shaped growth
    
    def test_classify_oscillation(self):
        """Test classification of oscillation pattern."""
        result = self.classifier.classify(self.test_data['oscillation'])
        self.assertEqual(result.class_name, 'oscct')  # Oscillation constant
    
    def test_classify_stasis(self):
        """Test classification of stasis pattern."""
        result = self.classifier.classify(self.test_data['stasis'])
        self.assertEqual(result.class_name, 'const')  # Constant
    
    def test_classification_result_structure(self):
        """Test that ClassificationResult has all expected fields."""
        result = self.classifier.classify(self.test_data['linear_growth'])
        
        self.assertIsInstance(result.class_id, int)
        self.assertIsInstance(result.class_name, str)
        self.assertIsInstance(result.class_description, str)
        self.assertIsInstance(result.likelihood, float)
        self.assertIsInstance(result.is_weak_match, bool)
        self.assertIsInstance(result.top_matches, list)
        self.assertEqual(len(result.top_matches), 3)  # Default top_n
    
    def test_top_n_parameter(self):
        """Test that top_n parameter controls number of matches."""
        result = self.classifier.classify(self.test_data['linear_growth'], top_n=5)
        self.assertEqual(len(result.top_matches), 5)
    
    def test_classify_with_list_input(self):
        """Test classification with list input (not numpy array)."""
        data_list = self.test_data['linear_growth'].tolist()
        result = self.classifier.classify(data_list)
        self.assertEqual(result.class_name, 'plinr')
    
    def test_classify_empty_data(self):
        """Test that empty data raises ValueError."""
        with self.assertRaises(ValueError):
            self.classifier.classify([])
    
    def test_classify_too_short_data(self):
        """Test that too short data raises ValueError."""
        with self.assertRaises(ValueError):
            self.classifier.classify([1, 2, 3])
    
    def test_hypothesis_correct(self):
        """Test hypothesis testing with correct hypothesis."""
        confirmed, is_weak = self.classifier.test_hypothesis(
            self.test_data['exponential_growth'], 'pexgr')
        self.assertTrue(confirmed)
    
    def test_hypothesis_incorrect(self):
        """Test hypothesis testing with incorrect hypothesis."""
        confirmed, is_weak = self.classifier.test_hypothesis(
            self.test_data['exponential_growth'], 'const')
        self.assertFalse(confirmed)
    
    def test_hypothesis_invalid_code(self):
        """Test hypothesis testing with invalid code raises ValueError."""
        with self.assertRaises(ValueError):
            self.classifier.test_hypothesis(self.test_data['linear_growth'], 'invalid_code')
    
    def test_classify_multiple(self):
        """Test classifying multiple time series at once."""
        results = self.classifier.classify_multiple(self.test_data)
        
        self.assertEqual(len(results), len(self.test_data))
        self.assertIn('linear_growth', results)
        self.assertIn('oscillation', results)
        
        self.assertEqual(results['linear_growth'].class_name, 'plinr')
        self.assertEqual(results['oscillation'].class_name, 'oscct')


class TestDataLoading(unittest.TestCase):
    """Test cases for data loading functions."""
    
    def setUp(self):
        """Set up temporary files for testing."""
        self.temp_dir = tempfile.mkdtemp()
    
    def tearDown(self):
        """Clean up temporary files."""
        import shutil
        shutil.rmtree(self.temp_dir)
    
    def test_load_csv_simple(self):
        """Test loading simple CSV file."""
        csv_path = os.path.join(self.temp_dir, "test.csv")
        with open(csv_path, 'w') as f:
            f.write("value\n")
            for i in range(50):
                f.write(f"{i * 2.0}\n")
        
        data = load_csv_data(csv_path)
        self.assertEqual(len(data), 50)
        self.assertEqual(data[0], 0.0)
        self.assertEqual(data[1], 2.0)
    
    def test_load_csv_with_column(self):
        """Test loading CSV with specific column."""
        csv_path = os.path.join(self.temp_dir, "test.csv")
        with open(csv_path, 'w') as f:
            f.write("time,value,other\n")
            for i in range(50):
                f.write(f"{i},{i * 2.0},{i * 3.0}\n")
        
        data = load_csv_data(csv_path, column="value")
        self.assertEqual(len(data), 50)
        self.assertEqual(data[1], 2.0)
    
    def test_load_json_array(self):
        """Test loading JSON array."""
        json_path = os.path.join(self.temp_dir, "test.json")
        test_data = [float(i) for i in range(50)]
        with open(json_path, 'w') as f:
            json.dump(test_data, f)
        
        data = load_json_data(json_path)
        self.assertEqual(len(data), 50)
        np.testing.assert_array_equal(data, test_data)
    
    def test_load_json_with_key(self):
        """Test loading JSON with specific key."""
        json_path = os.path.join(self.temp_dir, "test.json")
        test_data = {"values": [float(i) for i in range(50)]}
        with open(json_path, 'w') as f:
            json.dump(test_data, f)
        
        data = load_json_data(json_path, key="values")
        self.assertEqual(len(data), 50)


class TestOutputFormatting(unittest.TestCase):
    """Test cases for output formatting."""
    
    def setUp(self):
        """Create a sample result for testing."""
        self.result = ClassificationResult(
            class_id=2,
            class_name="plinr",
            class_description="Positive Linear Growth",
            likelihood=-3.5,
            is_weak_match=False,
            top_matches=[
                {"class_id": 2, "class_name": "plinr", 
                 "class_description": "Positive Linear Growth", "likelihood": -3.5},
                {"class_id": 22, "class_name": "oscct",
                 "class_description": "Oscillation Constant", "likelihood": -7.2},
            ]
        )
    
    def test_format_text(self):
        """Test text formatting."""
        output = format_output(self.result, "text")
        self.assertIn("plinr", output)
        self.assertIn("Positive Linear Growth", output)
        self.assertIn("-3.5", output)
    
    def test_format_json(self):
        """Test JSON formatting."""
        output = format_output(self.result, "json")
        parsed = json.loads(output)
        self.assertEqual(parsed["class_name"], "plinr")
        self.assertEqual(parsed["class_id"], 2)
    
    def test_format_csv(self):
        """Test CSV formatting."""
        output = format_output(self.result, "csv")
        parts = output.split(",")
        self.assertEqual(parts[0], "2")  # class_id
        self.assertEqual(parts[1], "plinr")  # class_name


class TestIntegration(unittest.TestCase):
    """Integration tests for the complete workflow."""
    
    def test_full_classification_workflow(self):
        """Test complete workflow from data to formatted output."""
        # Create classifier
        classifier = BehaviorClassifier()
        
        # Generate test data (strong exponential growth)
        np.random.seed(123)
        t = np.linspace(0, 10, 100)
        data = 5 * np.exp(0.5 * t)  # Strong exponential with no noise
        
        # Classify
        result = classifier.classify(data)
        
        # Verify result is an exponential growth pattern
        self.assertIn(result.class_name, ['pexgr', 'd1peg', 'd2peg'])  # Exponential growth variants
        
        # Format output
        text_output = format_output(result, "text")
        json_output = format_output(result, "json")
        
        self.assertIn(result.class_name, text_output)
        self.assertIn(result.class_name, json_output)
    
    def test_csv_to_classification_workflow(self):
        """Test workflow from CSV file to classification."""
        # Create temp CSV
        temp_dir = tempfile.mkdtemp()
        csv_path = os.path.join(temp_dir, "test_data.csv")
        
        try:
            np.random.seed(456)
            t = np.linspace(0, 10, 100)
            data = 50 + 20 * np.sin(2 * np.pi * 0.5 * t) + np.random.normal(0, 1, len(t))
            
            with open(csv_path, 'w') as f:
                f.write("value\n")
                for v in data:
                    f.write(f"{v}\n")
            
            # Load and classify
            loaded_data = load_csv_data(csv_path)
            classifier = BehaviorClassifier()
            result = classifier.classify(loaded_data)
            
            # Should be oscillation
            self.assertEqual(result.class_name, 'oscct')
        finally:
            import shutil
            shutil.rmtree(temp_dir)


def run_tests():
    """Run all tests and return exit code."""
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    
    # Add all test cases
    suite.addTests(loader.loadTestsFromTestCase(TestBehaviorClassifier))
    suite.addTests(loader.loadTestsFromTestCase(TestDataLoading))
    suite.addTests(loader.loadTestsFromTestCase(TestOutputFormatting))
    suite.addTests(loader.loadTestsFromTestCase(TestIntegration))
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(run_tests())
