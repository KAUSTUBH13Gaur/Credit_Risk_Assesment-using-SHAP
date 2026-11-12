
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pandas as pd
import joblib
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# --------------------------------------------------
# 1. MODEL FILE PATHS
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent

MODEL_PATH = BASE_DIR / "credit_risk_model.pkl"
THRESHOLD_PATH = BASE_DIR / "best_threshold.pkl"

ml_model = {}


# --------------------------------------------------
# 2. LOAD ML MODEL AND THRESHOLD
# --------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):

    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Model file not found: {MODEL_PATH}"
        )

    if not THRESHOLD_PATH.exists():
        raise FileNotFoundError(
            f"Threshold file not found: {THRESHOLD_PATH}"
        )

    ml_model["model"] = joblib.load(MODEL_PATH)
    ml_model["threshold"] = float(
        joblib.load(THRESHOLD_PATH)
    )

    print("Credit Risk Model loaded successfully!")
    print("Optimized Threshold:", ml_model["threshold"])

    yield

    ml_model.clear()
    print("ML Model unloaded.")


# --------------------------------------------------
# 3. FASTAPI APPLICATION
# --------------------------------------------------

app = FastAPI(
    title="Credit Risk Assessment API",
    description="ML-powered Credit Risk Prediction System",
    version="1.0.0",
    lifespan=lifespan
)


# --------------------------------------------------
# 4. CORS CONFIGURATION
# --------------------------------------------------

# Allows frontend integration during development.
# Restrict allowed origins before production deployment.

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# 5. APPLICANT INPUT VALIDATION
# --------------------------------------------------

class LoanApplication(BaseModel):

    person_age: int
    person_income: float
    person_home_ownership: str
    person_emp_length: float
    loan_intent: str
    loan_grade: str
    loan_amnt: float
    loan_int_rate: float
    loan_percent_income: float
    cb_person_default_on_file: str
    cb_person_cred_hist_length: int


# --------------------------------------------------
# 6. HEALTH CHECK ENDPOINT
# --------------------------------------------------

@app.get("/")
def home():

    return {
        "message": "Credit Risk Assessment API is running",
        "status": "Active"
    }


@app.get("/health")
def health_check():

    return {
        "status": "healthy",
        "model_loaded": "model" in ml_model,
        "threshold_loaded": "threshold" in ml_model
    }


# --------------------------------------------------
# 7. CREDIT RISK PREDICTION
# --------------------------------------------------

@app.post("/predict")
def predict(data: LoanApplication):

    try:

        # Convert applicant data into DataFrame
        input_df = pd.DataFrame([
            data.model_dump()
            if hasattr(data, "model_dump")
            else data.dict()
        ])

        # Generate default probability
        probability = float(
            ml_model["model"].predict_proba(input_df)[0][1]
        )

        # Get optimized threshold
        threshold = float(ml_model["threshold"])

        # Binary classification
        prediction = int(probability >= threshold)

        # Final risk result
        result = (
            "High Risk" if prediction == 1
            else "Low Risk"
        )

        return {
            "default_probability": probability,
            "default_prediction": prediction,
            "threshold": threshold,
            "Result": result
        }

    except Exception as e:

        print("Prediction Error:", str(e))

        raise HTTPException(
            status_code=500,
            detail=f"Prediction failed: {str(e)}"
        )

app.mount("/app", StaticFiles(directory=BASE_DIR / "static", html=True), name="ui")